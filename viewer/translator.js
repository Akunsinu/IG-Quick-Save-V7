// Translation module for Instagram Archive Viewer
// Uses MyMemory API (free, no API key required)
// Rate limit: ~100 requests/day on free tier

class Translator {
  constructor() {
    this.cache = new Map();
    this.targetLang = 'en';
    this.apiEndpoint = 'https://api.mymemory.translated.net/get';
    this.requestDelay = 500; // ms between requests to avoid rate limiting
    this.lastRequestTime = 0;
  }

  /**
   * Translate a single text string to English
   * @param {string} text - Text to translate
   * @returns {Promise<string>} - Translated text
   */
  async translate(text) {
    if (!text || text.trim() === '') return '';

    // Check cache first
    const cacheKey = text.trim();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Rate limiting - wait if needed
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelay) {
      await this.sleep(this.requestDelay - timeSinceLastRequest);
    }

    try {
      const url = `${this.apiEndpoint}?q=${encodeURIComponent(text)}&langpair=auto|${this.targetLang}`;
      const response = await fetch(url);
      this.lastRequestTime = Date.now();

      if (!response.ok) {
        console.warn('Translation API error:', response.status);
        return text; // Return original on error
      }

      const data = await response.json();

      if (data.responseStatus === 200 && data.responseData) {
        const translated = data.responseData.translatedText;

        // Don't cache if translation is same as original (likely already English)
        if (translated.toLowerCase() !== text.toLowerCase()) {
          this.cache.set(cacheKey, translated);
        }

        return translated;
      }

      // Handle quota exceeded
      if (data.responseStatus === 429 || data.quotaFinished) {
        console.warn('Translation API quota exceeded');
        throw new Error('QUOTA_EXCEEDED');
      }

      return text; // Return original on failure
    } catch (error) {
      if (error.message === 'QUOTA_EXCEEDED') {
        throw error;
      }
      console.error('Translation error:', error);
      return text; // Return original on error
    }
  }

  /**
   * Translate an entire post (caption and all comments)
   * @param {Object} postData - Post data object
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Object>} - Post data with translations added
   */
  async translatePost(postData, progressCallback = null) {
    const totalItems = this.countTranslatableItems(postData);
    let completed = 0;

    const updateProgress = () => {
      completed++;
      if (progressCallback) {
        progressCallback(completed, totalItems);
      }
    };

    try {
      // Translate caption
      let translatedCaption = '';
      if (postData.caption) {
        translatedCaption = await this.translate(postData.caption);
        updateProgress();
      }

      // Translate all comments recursively
      const translatedComments = await this.translateComments(
        postData.comments || [],
        updateProgress
      );

      return {
        ...postData,
        caption_en: translatedCaption,
        comments: translatedComments,
        translation_status: 'completed',
        translation_date: new Date().toISOString()
      };
    } catch (error) {
      if (error.message === 'QUOTA_EXCEEDED') {
        return {
          ...postData,
          translation_status: 'quota_exceeded',
          translation_error: 'API quota exceeded. Try again tomorrow.'
        };
      }
      throw error;
    }
  }

  /**
   * Translate comments array recursively (including replies)
   * @param {Array} comments - Array of comment objects
   * @param {Function} updateProgress - Progress callback
   * @returns {Promise<Array>} - Comments with translations added
   */
  async translateComments(comments, updateProgress = null) {
    const translatedComments = [];

    for (const comment of comments) {
      // Translate comment text
      const translatedText = await this.translate(comment.text || '');
      if (updateProgress) updateProgress();

      // Translate replies recursively
      const translatedReplies = comment.replies && comment.replies.length > 0
        ? await this.translateComments(comment.replies, updateProgress)
        : [];

      translatedComments.push({
        ...comment,
        text_en: translatedText,
        replies: translatedReplies
      });
    }

    return translatedComments;
  }

  /**
   * Count total translatable items in a post
   * @param {Object} postData - Post data object
   * @returns {number} - Total count
   */
  countTranslatableItems(postData) {
    let count = postData.caption ? 1 : 0;

    const countComments = (comments) => {
      if (!comments) return 0;
      let total = comments.length;
      for (const comment of comments) {
        if (comment.replies && comment.replies.length > 0) {
          total += countComments(comment.replies);
        }
      }
      return total;
    };

    count += countComments(postData.comments);
    return count;
  }

  /**
   * Save translations to localStorage
   * @param {Object} post - Post with translations
   */
  saveToStorage(post) {
    if (!post.shortcode) return;

    const key = `translation_${post.shortcode}`;
    const translations = {
      caption_en: post.caption_en,
      translation_status: post.translation_status,
      translation_date: post.translation_date,
      comments: this.extractCommentTranslations(post.comments || [])
    };

    try {
      localStorage.setItem(key, JSON.stringify(translations));
    } catch (error) {
      console.warn('Failed to save translation to storage:', error);
    }
  }

  /**
   * Extract just the translation data from comments (for storage efficiency)
   * @param {Array} comments - Comments with translations
   * @returns {Array} - Minimal translation data
   */
  extractCommentTranslations(comments) {
    return comments.map(c => ({
      id: c.id,
      text_en: c.text_en,
      replies: c.replies ? this.extractCommentTranslations(c.replies) : []
    }));
  }

  /**
   * Load translations from localStorage and merge into post
   * @param {Object} post - Post data
   * @returns {Object} - Post with translations merged
   */
  loadFromStorage(post) {
    if (!post.shortcode) return post;

    const key = `translation_${post.shortcode}`;
    const cached = localStorage.getItem(key);

    if (!cached) return post;

    try {
      const translations = JSON.parse(cached);
      return this.mergeTranslations(post, translations);
    } catch (error) {
      console.warn('Failed to load translation from storage:', error);
      return post;
    }
  }

  /**
   * Merge cached translations into post data
   * @param {Object} post - Original post
   * @param {Object} translations - Cached translations
   * @returns {Object} - Merged post
   */
  mergeTranslations(post, translations) {
    const mergeCommentTranslations = (comments, translationMap) => {
      if (!comments || !translationMap) return comments;

      // Build a map for quick lookup
      const transMap = new Map();
      translationMap.forEach(t => transMap.set(t.id, t));

      return comments.map(comment => {
        const trans = transMap.get(comment.id);
        if (!trans) return comment;

        return {
          ...comment,
          text_en: trans.text_en,
          replies: comment.replies
            ? mergeCommentTranslations(comment.replies, trans.replies)
            : []
        };
      });
    };

    return {
      ...post,
      caption_en: translations.caption_en,
      translation_status: translations.translation_status,
      translation_date: translations.translation_date,
      comments: mergeCommentTranslations(post.comments, translations.comments)
    };
  }

  /**
   * Check if a post has been translated
   * @param {Object} post - Post data
   * @returns {boolean}
   */
  isTranslated(post) {
    return post.translation_status === 'completed';
  }

  /**
   * Check if translation exists in storage
   * @param {string} shortcode - Post shortcode
   * @returns {boolean}
   */
  hasStoredTranslation(shortcode) {
    return localStorage.getItem(`translation_${shortcode}`) !== null;
  }

  /**
   * Clear translation from storage
   * @param {string} shortcode - Post shortcode
   */
  clearStoredTranslation(shortcode) {
    localStorage.removeItem(`translation_${shortcode}`);
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in viewer
if (typeof window !== 'undefined') {
  window.Translator = Translator;
}
