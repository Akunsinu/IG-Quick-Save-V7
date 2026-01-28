// Google Sheets Sync Module for IG Quick Save
// Handles all communication with Google Sheets via Apps Script Web App
// Version: 1.1.0

const SheetsSync = {
  // Configuration (loaded from storage)
  config: {
    webAppUrl: null,        // Apps Script Web App URL
    userId: null,           // Current user identifier (e.g., "John", "TeamA")
    enabled: false,         // Whether sync is enabled
    lastSync: null,         // Last sync timestamp
    skipTeamDownloaded: false, // Skip posts downloaded by team members
  },

  // Local cache of downloaded data from Sheets
  cache: {
    downloads: new Map(),   // shortcode -> download record
    profiles: new Map(),    // username -> profile stats
    names: new Map(),       // username (lowercase) -> real name
    lastFetched: null,      // Timestamp of last cache refresh
  },

  // ===== HELPER: Bounded cache addition =====
  _addToDownloadsCache(shortcode, record) {
    const maxSize = (typeof CONFIG !== 'undefined' && CONFIG?.PERFORMANCE?.MAX_SHEETS_CACHE_SIZE) || 50000;

    // If at limit and this is a new entry, remove oldest entries (LRU-style via iterator)
    if (this.cache.downloads.size >= maxSize && !this.cache.downloads.has(shortcode)) {
      // Remove first (oldest) entry
      const firstKey = this.cache.downloads.keys().next().value;
      this.cache.downloads.delete(firstKey);
      console.log('[SheetsSync] ⚠️ Cache at limit, evicted oldest entry');
    }

    this.cache.downloads.set(shortcode, record);
  },

  // ===== INITIALIZATION =====

  /**
   * Initialize the sync module - call on service worker startup
   */
  async init() {
    try {
      // Load configuration from storage
      const stored = await chrome.storage.local.get([
        'sheetsWebAppUrl',
        'sheetsUserId',
        'sheetsSyncEnabled',
        'sheetsLastSync',
        'sheetsSkipTeamDownloaded'
      ]);

      this.config.webAppUrl = stored.sheetsWebAppUrl || null;
      this.config.userId = stored.sheetsUserId || null;
      this.config.enabled = stored.sheetsSyncEnabled || false;
      this.config.lastSync = stored.sheetsLastSync || null;
      this.config.skipTeamDownloaded = stored.sheetsSkipTeamDownloaded || false;

      // If enabled and configured, refresh cache
      if (this.config.enabled && this.config.webAppUrl) {
        await this.refreshCache();
      }

      console.log('[SheetsSync] Initialized:', this.config.enabled ? 'ENABLED' : 'disabled');
      return this.config.enabled;
    } catch (error) {
      console.error('[SheetsSync] Init error:', error);
      return false;
    }
  },

  // ===== CONFIGURATION =====

  /**
   * Configure the sync settings
   * @param {string} webAppUrl - Google Apps Script Web App URL
   * @param {string} userId - User identifier for tracking who downloaded
   */
  async configure(webAppUrl, userId) {
    try {
      this.config.webAppUrl = webAppUrl;
      this.config.userId = userId;
      this.config.enabled = !!(webAppUrl && userId);

      await chrome.storage.local.set({
        sheetsWebAppUrl: webAppUrl,
        sheetsUserId: userId,
        sheetsSyncEnabled: this.config.enabled
      });

      // If enabled, refresh cache
      if (this.config.enabled) {
        const refreshResult = await this.refreshCache();
        return { success: true, enabled: this.config.enabled, ...refreshResult };
      }

      return { success: true, enabled: this.config.enabled };
    } catch (error) {
      console.error('[SheetsSync] Configure error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Set the skip team downloaded preference
   */
  async setSkipTeamDownloaded(skip) {
    this.config.skipTeamDownloaded = skip;
    await chrome.storage.local.set({ sheetsSkipTeamDownloaded: skip });
    return { success: true };
  },

  // ===== CACHE MANAGEMENT =====

  /**
   * Refresh local cache from Google Sheets
   */
  async refreshCache() {
    if (!this.config.enabled || !this.config.webAppUrl) {
      return { success: false, error: 'Sync not configured' };
    }

    try {
      console.log('[SheetsSync] Refreshing cache from Google Sheets...');

      // Fetch all downloads
      const downloadsResponse = await this._fetch(`${this.config.webAppUrl}?action=getAll`);

      if (!downloadsResponse.ok) {
        throw new Error(`HTTP ${downloadsResponse.status}: ${downloadsResponse.statusText}`);
      }

      const downloadsData = await downloadsResponse.json();

      if (downloadsData.error) {
        throw new Error(downloadsData.error);
      }

      // Update local cache with size limit
      this.cache.downloads.clear();
      const downloads = downloadsData.downloads || [];
      const maxCacheSize = (typeof CONFIG !== 'undefined' && CONFIG?.PERFORMANCE?.MAX_SHEETS_CACHE_SIZE) || 50000;

      // If too many downloads, keep only the most recent ones (assuming they come sorted by date)
      const downloadsToCache = downloads.length > maxCacheSize
        ? downloads.slice(-maxCacheSize)
        : downloads;

      if (downloads.length > maxCacheSize) {
        console.warn(`[SheetsSync] ⚠️ Trimming cache from ${downloads.length} to ${maxCacheSize} entries`);
      }

      downloadsToCache.forEach(record => {
        this.cache.downloads.set(record.shortcode, record);
      });

      // Fetch profile stats
      const profilesResponse = await this._fetch(`${this.config.webAppUrl}?action=getProfiles`);
      const profilesData = await profilesResponse.json();

      this.cache.profiles.clear();
      const profiles = profilesData.profiles || [];
      profiles.forEach(profile => {
        this.cache.profiles.set(profile.username, profile);
      });

      // Fetch name mappings
      const namesResponse = await this._fetch(`${this.config.webAppUrl}?action=getNames`);
      const namesData = await namesResponse.json();

      this.cache.names.clear();
      const names = namesData.names || [];
      names.forEach(nameRecord => {
        if (nameRecord.username) {
          this.cache.names.set(nameRecord.username.toLowerCase(), nameRecord.realName);
        }
      });

      // Update timestamps
      this.cache.lastFetched = Date.now();
      this.config.lastSync = new Date().toISOString();

      await chrome.storage.local.set({
        sheetsLastSync: this.config.lastSync
      });

      console.log('[SheetsSync] Cache refreshed:', {
        downloads: this.cache.downloads.size,
        profiles: this.cache.profiles.size,
        names: this.cache.names.size
      });

      return {
        success: true,
        downloadCount: this.cache.downloads.size,
        profileCount: this.cache.profiles.size,
        nameCount: this.cache.names.size
      };

    } catch (error) {
      console.error('[SheetsSync] Refresh error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== QUERY METHODS =====

  /**
   * Check if a shortcode is already downloaded (from cache)
   * @param {string} shortcode - Instagram post shortcode
   * @returns {boolean|object} - false if not downloaded, or download record if found
   */
  isDownloaded(shortcode) {
    if (!this.config.enabled) return false;
    return this.cache.downloads.get(shortcode) || false;
  },

  /**
   * Check if a shortcode was downloaded by another team member
   * @param {string} shortcode - Instagram post shortcode
   * @returns {boolean|object} - false if not downloaded by others, or download record
   */
  isDownloadedByOthers(shortcode) {
    if (!this.config.enabled) return false;
    const record = this.cache.downloads.get(shortcode);
    if (record && record.downloader !== this.config.userId) {
      return record;
    }
    return false;
  },

  /**
   * Get profile completion stats
   * @param {string} username - Instagram username
   * @returns {object|null} - Profile stats or null
   */
  getProfileStats(username) {
    if (!this.config.enabled) return null;
    return this.cache.profiles.get(username) || null;
  },

  /**
   * Get all downloaded posts for a username
   * @param {string} username - Instagram username
   * @returns {array} - Array of download records
   */
  getDownloadsForUser(username) {
    if (!this.config.enabled) return [];
    const downloads = [];
    this.cache.downloads.forEach((record, shortcode) => {
      if (record.username === username) {
        downloads.push(record);
      }
    });
    return downloads;
  },

  // ===== NAME MAPPING METHODS =====

  /**
   * Look up a real name for a username (from cache)
   * @param {string} username - Instagram username
   * @returns {string|null} - Real name or null if not found
   */
  lookupName(username) {
    if (!this.config.enabled || !username) return null;
    return this.cache.names.get(username.toLowerCase().trim()) || null;
  },

  /**
   * Check if a username has a name mapping
   * @param {string} username - Instagram username
   * @returns {boolean}
   */
  hasNameMapping(username) {
    if (!this.config.enabled || !username) return false;
    return this.cache.names.has(username.toLowerCase().trim());
  },

  /**
   * Add a new name mapping
   * @param {string} username - Instagram username
   * @param {string} realName - Real name to map to
   */
  async addName(username, realName) {
    if (!this.config.enabled || !this.config.webAppUrl) {
      return { success: false, error: 'Sync not configured' };
    }

    if (!username || !realName) {
      return { success: false, error: 'Username and real name are required' };
    }

    try {
      const response = await this._fetch(this.config.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addName',
          username: username.toLowerCase().trim(),
          realName: realName.trim()
        })
      });

      const result = await response.json();

      if (result.success) {
        // Update local cache immediately
        this.cache.names.set(username.toLowerCase().trim(), realName.trim());
        console.log('[SheetsSync] Name added:', username, '->', realName);
      }

      return result;

    } catch (error) {
      console.error('[SheetsSync] Add name error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Update an existing name mapping
   * @param {string} username - Instagram username
   * @param {string} realName - New real name
   */
  async updateName(username, realName) {
    if (!this.config.enabled || !this.config.webAppUrl) {
      return { success: false, error: 'Sync not configured' };
    }

    if (!username || !realName) {
      return { success: false, error: 'Username and real name are required' };
    }

    try {
      const response = await this._fetch(this.config.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateName',
          username: username.toLowerCase().trim(),
          realName: realName.trim()
        })
      });

      const result = await response.json();

      if (result.success) {
        // Update local cache
        this.cache.names.set(username.toLowerCase().trim(), realName.trim());
        console.log('[SheetsSync] Name updated:', username, '->', realName);
      }

      return result;

    } catch (error) {
      console.error('[SheetsSync] Update name error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get all name mappings
   * @returns {array} - Array of {username, realName} objects
   */
  getAllNames() {
    const names = [];
    this.cache.names.forEach((realName, username) => {
      names.push({ username, realName });
    });
    return names;
  },

  // ===== TRACKING METHODS =====

  /**
   * Track a single download
   * @param {object} postInfo - Post information from extraction
   */
  async trackDownload(postInfo) {
    if (!this.config.enabled || !this.config.webAppUrl) {
      return { success: false, error: 'Sync not configured' };
    }

    // Look up real name from local cache
    const realName = this.lookupName(postInfo.username) || '';

    const record = {
      action: 'addDownload',
      shortcode: postInfo.shortcode,
      url: postInfo.url || `https://www.instagram.com/p/${postInfo.shortcode}/`,
      real_name: realName,
      username: postInfo.username,
      post_type: postInfo.post_type || 'POST',
      media_count: postInfo.media_count || 0,
      comment_count: postInfo.comment_count || 0,
      caption: postInfo.caption || '',
      downloader: this.config.userId,
      post_date: postInfo.posted_at || '',
      collaborators: Array.isArray(postInfo.collaborators) ? postInfo.collaborators.join(', ') : ''
    };

    try {
      const response = await this._fetch(this.config.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });

      const result = await response.json();

      if (result.success && result.added) {
        // Update local cache immediately (with bounds check)
        this._addToDownloadsCache(record.shortcode, {
          ...record,
          timestamp: new Date().toISOString()
        });
      }

      console.log('[SheetsSync] Track download:', result);
      return result;

    } catch (error) {
      console.error('[SheetsSync] Track error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Track multiple downloads (batch)
   * @param {array} downloads - Array of post info objects
   */
  async trackBatchDownloads(downloads) {
    if (!this.config.enabled || !this.config.webAppUrl) {
      return { success: false, error: 'Sync not configured' };
    }

    const records = downloads.map(postInfo => {
      // Look up real name from local cache
      const realName = this.lookupName(postInfo.username) || '';

      return {
        shortcode: postInfo.shortcode,
        url: postInfo.url || `https://www.instagram.com/p/${postInfo.shortcode}/`,
        real_name: realName,
        username: postInfo.username,
        post_type: postInfo.post_type || 'POST',
        media_count: postInfo.media_count || 0,
        comment_count: postInfo.comment_count || 0,
        caption: postInfo.caption || '',
        downloader: this.config.userId,
        post_date: postInfo.posted_at || '',
        collaborators: Array.isArray(postInfo.collaborators) ? postInfo.collaborators.join(', ') : ''
      };
    });

    try {
      const response = await this._fetch(this.config.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addBatch',
          downloads: records
        })
      });

      const result = await response.json();

      if (result.success) {
        // Update local cache (with bounds check)
        records.forEach(record => {
          if (!this.cache.downloads.has(record.shortcode)) {
            this._addToDownloadsCache(record.shortcode, {
              ...record,
              timestamp: new Date().toISOString()
            });
          }
        });
      }

      console.log('[SheetsSync] Batch track:', result);
      return result;

    } catch (error) {
      console.error('[SheetsSync] Batch error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Update total posts for a profile (for completion % calculation)
   * @param {string} username - Instagram username
   * @param {number} totalPosts - Total posts on the profile
   */
  async updateProfileTotal(username, totalPosts) {
    if (!this.config.enabled || !this.config.webAppUrl) {
      return { success: false, error: 'Sync not configured' };
    }

    try {
      const response = await this._fetch(this.config.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfileTotal',
          username: username,
          totalPosts: totalPosts
        })
      });

      const result = await response.json();

      if (result.success) {
        // Refresh profile cache
        const profilesResponse = await this._fetch(`${this.config.webAppUrl}?action=getProfiles`);
        const profilesData = await profilesResponse.json();

        this.cache.profiles.clear();
        (profilesData.profiles || []).forEach(profile => {
          this.cache.profiles.set(profile.username, profile);
        });
      }

      return result;

    } catch (error) {
      console.error('[SheetsSync] Update profile error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== STATUS & UTILITIES =====

  /**
   * Get sync status
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      configured: !!(this.config.webAppUrl && this.config.userId),
      userId: this.config.userId,
      lastSync: this.config.lastSync,
      skipTeamDownloaded: this.config.skipTeamDownloaded,
      cacheSize: {
        downloads: this.cache.downloads.size,
        profiles: this.cache.profiles.size,
        names: this.cache.names.size
      }
    };
  },

  /**
   * Check if cache needs refresh (older than 5 minutes)
   */
  needsRefresh() {
    if (!this.cache.lastFetched) return true;
    const fiveMinutes = 5 * 60 * 1000;
    return (Date.now() - this.cache.lastFetched) > fiveMinutes;
  },

  /**
   * Helper: Fetch with timeout
   */
  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
};

// Export for use in service worker
if (typeof self !== 'undefined') {
  self.SheetsSync = SheetsSync;
}
