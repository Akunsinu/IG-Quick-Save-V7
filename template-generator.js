// HTML Template Generator for Instagram Post Archive
// Generates a standalone HTML file that recreates the Instagram post

function generatePostHTML(postData) {
  const { media, comments, post_info } = postData;

  // Extract post info
  const username = post_info?.username || 'unknown';
  const fullName = post_info?.full_name || username;
  const caption = post_info?.caption || '';
  const likeCount = post_info?.like_count || 0;
  const commentCount = post_info?.comment_count || 0;
  const postedAt = post_info?.posted_at || '';
  const postUrl = post_info?.post_url || '';

  // Format date
  let formattedDate = 'Unknown date';
  if (postedAt) {
    const date = new Date(postedAt);
    formattedDate = date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Generate media HTML
  let mediaHTML = '';
  if (media && media.length > 0) {
    if (media.length === 1) {
      // Single media item
      const item = media[0];
      if (item.video_url) {
        mediaHTML = `
          <video controls class="post-media">
            <source src="${item.video_url}" type="video/mp4">
            Your browser does not support the video tag.
          </video>
        `;
      } else if (item.image_url) {
        mediaHTML = `<img src="${item.image_url}" alt="Post media" class="post-media">`;
      }
    } else {
      // Multiple media items (carousel)
      mediaHTML = `
        <div class="carousel">
          <div class="carousel-container">
            ${media.map((item, index) => {
              if (item.video_url) {
                return `
                  <div class="carousel-item ${index === 0 ? 'active' : ''}">
                    <video controls class="post-media">
                      <source src="${item.video_url}" type="video/mp4">
                    </video>
                  </div>
                `;
              } else if (item.image_url) {
                return `
                  <div class="carousel-item ${index === 0 ? 'active' : ''}">
                    <img src="${item.image_url}" alt="Post media ${index + 1}" class="post-media">
                  </div>
                `;
              }
              return '';
            }).join('')}
          </div>
          <button class="carousel-btn prev" onclick="moveCarousel(-1)">❮</button>
          <button class="carousel-btn next" onclick="moveCarousel(1)">❯</button>
          <div class="carousel-dots">
            ${media.map((_, index) =>
              `<span class="dot ${index === 0 ? 'active' : ''}" onclick="currentSlide(${index + 1})"></span>`
            ).join('')}
          </div>
        </div>
      `;
    }
  }

  // Generate comments HTML
  function renderComment(comment, isReply = false) {
    const commentDate = new Date(comment.created_at * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    return `
      <div class="comment ${isReply ? 'reply' : ''}">
        <div class="comment-header">
          <span class="comment-username">${comment.owner?.username || 'Unknown'}</span>
          <span class="comment-date">${commentDate}</span>
        </div>
        <div class="comment-text">${escapeHTML(comment.text || '')}</div>
        <div class="comment-footer">
          <span class="comment-likes">${comment.like_count || 0} likes</span>
        </div>
        ${comment.replies && comment.replies.length > 0 ? `
          <div class="replies">
            ${comment.replies.map(reply => renderComment(reply, true)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  const commentsHTML = comments && comments.length > 0
    ? comments.map(comment => renderComment(comment)).join('')
    : '<p class="no-comments">No comments</p>';

  // Generate complete HTML
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${username} - Instagram Post Archive</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #fafafa;
      color: #262626;
      padding: 20px;
    }

    .container {
      max-width: 935px;
      margin: 0 auto;
      background: white;
      border: 1px solid #dbdbdb;
      border-radius: 8px;
      overflow: hidden;
    }

    .post-header {
      padding: 16px;
      border-bottom: 1px solid #efefef;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .username {
      font-weight: 600;
      font-size: 14px;
    }

    .full-name {
      color: #8e8e8e;
      font-size: 12px;
    }

    .post-date {
      color: #8e8e8e;
      font-size: 12px;
    }

    .media-container {
      background: #000;
      position: relative;
      width: 100%;
      min-height: 400px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .post-media {
      width: 100%;
      max-height: 600px;
      object-fit: contain;
    }

    /* Carousel styles */
    .carousel {
      position: relative;
      width: 100%;
    }

    .carousel-container {
      position: relative;
      width: 100%;
      min-height: 400px;
      background: #000;
    }

    .carousel-item {
      display: none;
      width: 100%;
    }

    .carousel-item.active {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .carousel-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(0, 0, 0, 0.5);
      color: white;
      border: none;
      padding: 10px 15px;
      cursor: pointer;
      font-size: 18px;
      border-radius: 4px;
      z-index: 10;
    }

    .carousel-btn:hover {
      background: rgba(0, 0, 0, 0.8);
    }

    .carousel-btn.prev {
      left: 10px;
    }

    .carousel-btn.next {
      right: 10px;
    }

    .carousel-dots {
      text-align: center;
      padding: 10px;
      background: #000;
    }

    .dot {
      height: 8px;
      width: 8px;
      margin: 0 4px;
      background-color: #bbb;
      border-radius: 50%;
      display: inline-block;
      cursor: pointer;
    }

    .dot.active {
      background-color: #0095f6;
    }

    .post-stats {
      padding: 16px;
      border-bottom: 1px solid #efefef;
    }

    .stats-row {
      display: flex;
      gap: 16px;
      margin-bottom: 8px;
    }

    .stat {
      font-weight: 600;
      font-size: 14px;
    }

    .caption {
      padding: 16px;
      border-bottom: 1px solid #efefef;
    }

    .caption-username {
      font-weight: 600;
      margin-right: 8px;
    }

    .caption-text {
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .comments-section {
      max-height: 500px;
      overflow-y: auto;
      padding: 16px;
    }

    .comments-header {
      font-weight: 600;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #efefef;
    }

    .comment {
      margin-bottom: 16px;
      padding-left: 0;
    }

    .comment.reply {
      margin-left: 32px;
      padding-left: 16px;
      border-left: 2px solid #efefef;
    }

    .comment-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .comment-username {
      font-weight: 600;
      font-size: 14px;
    }

    .comment-date {
      color: #8e8e8e;
      font-size: 12px;
    }

    .comment-text {
      font-size: 14px;
      margin-bottom: 4px;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .comment-footer {
      display: flex;
      gap: 12px;
      color: #8e8e8e;
      font-size: 12px;
    }

    .comment-likes {
      font-weight: 600;
    }

    .replies {
      margin-top: 12px;
    }

    .no-comments {
      text-align: center;
      color: #8e8e8e;
      padding: 40px;
    }

    .footer {
      padding: 16px;
      background: #fafafa;
      border-top: 1px solid #efefef;
      text-align: center;
      font-size: 12px;
      color: #8e8e8e;
    }

    .footer a {
      color: #0095f6;
      text-decoration: none;
    }

    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Post Header -->
    <div class="post-header">
      <div class="user-info">
        <div>
          <div class="username">${escapeHTML(username)}</div>
          ${fullName !== username ? `<div class="full-name">${escapeHTML(fullName)}</div>` : ''}
        </div>
      </div>
      <div class="post-date">${formattedDate}</div>
    </div>

    <!-- Media -->
    <div class="media-container">
      ${mediaHTML}
    </div>

    <!-- Stats -->
    <div class="post-stats">
      <div class="stats-row">
        <span class="stat">${likeCount.toLocaleString()} likes</span>
        <span class="stat">${commentCount.toLocaleString()} comments</span>
      </div>
    </div>

    <!-- Caption -->
    ${caption ? `
      <div class="caption">
        <span class="caption-username">${escapeHTML(username)}</span>
        <span class="caption-text">${escapeHTML(caption)}</span>
      </div>
    ` : ''}

    <!-- Comments -->
    <div class="comments-section">
      <div class="comments-header">Comments</div>
      ${commentsHTML}
    </div>

    <!-- Footer -->
    <div class="footer">
      Archived from <a href="${postUrl}" target="_blank">Instagram</a> on ${new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })}
    </div>
  </div>

  <script>
    // Carousel functionality
    let currentSlideIndex = 1;
    showSlide(currentSlideIndex);

    function moveCarousel(n) {
      showSlide(currentSlideIndex += n);
    }

    function currentSlide(n) {
      showSlide(currentSlideIndex = n);
    }

    function showSlide(n) {
      const slides = document.getElementsByClassName("carousel-item");
      const dots = document.getElementsByClassName("dot");

      if (slides.length === 0) return;

      if (n > slides.length) { currentSlideIndex = 1; }
      if (n < 1) { currentSlideIndex = slides.length; }

      for (let i = 0; i < slides.length; i++) {
        slides[i].classList.remove('active');
      }

      for (let i = 0; i < dots.length; i++) {
        dots[i].classList.remove('active');
      }

      slides[currentSlideIndex - 1].classList.add('active');
      if (dots.length > 0) {
        dots[currentSlideIndex - 1].classList.add('active');
      }
    }
  </script>
</body>
</html>`;
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generatePostHTML };
}
