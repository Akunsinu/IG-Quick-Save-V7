# Instagram Post & Comments Downloader

A Chrome extension that downloads both **media** (photos/videos) and **comments** from Instagram posts in one click!

## ✨ Features

- 📸 **Download Media** - Save all photos and videos from any Instagram post
- 💬 **Export Comments** - Download comments with nested replies
- 📦 **Download Everything** - Get media, comments, and metadata in one organized package
- 📊 **Multiple Formats** - Export comments as JSON or CSV
- 🎯 **Single Post Focus** - Works on individual Instagram posts (not bulk scraping)
- 📁 **Organized Downloads** - Files are automatically organized in folders

## 🚀 Installation

### Step 1: Load the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Navigate to the `instagram-combined-downloader` folder and select it
5. The extension icon should appear in your Chrome toolbar

### Step 2: Set Download Location (Optional)

1. Go to Chrome Settings → Downloads
2. Choose where you want files to be saved
3. Consider enabling "Ask where to save each file before downloading" for more control

## 📖 How to Use

### Basic Usage

1. **Open an Instagram post** in Chrome
   - Navigate to any post URL like: `https://www.instagram.com/p/ABC123/`

2. **Click the extension icon** in your toolbar
   - You should see the popup interface

3. **Extract Data**
   - Click the "**Extract Post Data**" button
   - Wait 2-3 seconds for data to be extracted
   - You'll see statistics showing how many media files and comments were found

4. **Download Options**
   - **📷 Media** - Download only photos/videos
   - **💬 Comments** - Download only comments (choose JSON or CSV format)
   - **⬇️ Download Everything** - Download media, comments, and metadata

### Download Structure

Files are organized like this:

```
Downloads/
└── Instagram/
    └── [shortcode]/
        ├── metadata.json          # Post info (URL, counts, timestamp)
        ├── media/
        │   ├── [shortcode]_1.jpg  # First image/video
        │   ├── [shortcode]_2.jpg  # Second image/video
        │   └── ...
        └── comments/
            ├── comments.json      # Full comment data with replies
            └── comments.csv       # Spreadsheet-friendly format
```

## 📋 File Formats

### Comments JSON Format
```json
{
  "total": 150,
  "comments": [
    {
      "id": "123456",
      "text": "Great post!",
      "created_at": 1697654321,
      "owner": {
        "id": "user123",
        "username": "johndoe",
        "profile_pic_url": "https://..."
      },
      "like_count": 5,
      "replies": [
        {
          "id": "789012",
          "text": "Thanks!",
          ...
        }
      ]
    }
  ]
}
```

### Comments CSV Format
```csv
"ID","Username","Text","Created At","Likes","Is Reply"
"123456","johndoe","Great post!","2024-10-18T12:34:56Z","5","No"
"789012","janedoe","Thanks!","2024-10-18T12:35:10Z","2","Yes"
```

### Metadata JSON Format
```json
{
  "shortcode": "ABC123",
  "url": "https://www.instagram.com/p/ABC123/",
  "downloaded_at": "2024-10-18T10:30:00.000Z",
  "media_count": 3,
  "comment_count": 150
}
```

## 🔧 Troubleshooting

### "Please open an Instagram post to use this extension"
- Make sure you're on a post URL (contains `/p/`)
- Refresh the page and try again

### "No data found. Try refreshing the page."
- Refresh the Instagram page
- Wait for the page to fully load before clicking extract
- Some posts may have privacy restrictions

### Data extraction shows 0 comments
- The post might not have any comments
- Comments might be disabled for that post
- Try scrolling down to load comments first, then extract

### Downloads not working
- Check Chrome's download settings
- Make sure you've granted download permissions
- Check if popup blockers are interfering

### Extension icon doesn't appear
- Refresh the `chrome://extensions/` page
- Make sure "Developer mode" is enabled
- Try removing and re-adding the extension

## ⚠️ Important Notes

### Legal & Ethical Use

This extension is for **personal, educational, and research purposes only**:

✅ **Appropriate Uses:**
- Backing up your own content
- Archiving posts you created
- Research with proper permissions
- Saving public content for personal reference

❌ **Inappropriate Uses:**
- Scraping large amounts of data
- Violating Instagram's Terms of Service
- Harvesting user data without consent
- Commercial use without permission

### Limitations

- **Works on individual posts only** - Not designed for bulk downloading
- **Requires page to be loaded** - Must visit each post manually
- **Limited comment extraction** - Only gets comments already loaded on the page
- **No private content** - Cannot access private accounts or posts you don't have permission to view
- **Rate limiting** - Instagram may restrict access if you download too much too quickly

### Privacy & Data

- **All processing is local** - No data is sent to external servers
- **No tracking** - Extension doesn't collect any user data
- **No accounts needed** - Works with your existing Instagram session
- **Storage** - Downloads are saved to your default Chrome downloads folder

## 🛠️ Technical Details

### Architecture

- **Manifest V3** - Uses latest Chrome extension standards
- **Content Script** - Bridges extension and Instagram page
- **Injected Script** - Accesses Instagram's internal data structures
- **Service Worker** - Handles downloads and file generation

### How It Works

1. **Injection** - Script is injected into Instagram's page context
2. **Data Access** - Reads from Instagram's React Fiber tree and internal data
3. **Extraction** - Parses post data, media URLs, and comment threads
4. **Download** - Uses Chrome Downloads API to save files locally

### Permissions Explained

- `activeTab` - Access the current Instagram tab
- `downloads` - Save files to your computer
- `storage` - Remember settings (future feature)
- `host_permissions` - Only works on instagram.com

## 🐛 Known Issues

- Carousel posts with 10+ items may take longer to process
- Very long comment threads (500+) might not all be visible
- Video downloads use the URL currently available (quality may vary)
- Some posts with restricted comments won't show comment data

## 🔄 Version History

### Version 1.0.0 (2024-10-18)
- Initial release
- Basic media downloading
- Comment export (JSON & CSV)
- Combined download feature
- Organized file structure

## 🤝 Contributing

This is an educational project. If you want to improve it:

1. Fork the repository
2. Make your changes
3. Test thoroughly
4. Create a pull request

## 📄 License

This project is provided as-is for educational purposes. Use responsibly and at your own risk.

## 💡 Tips

1. **Download Speed** - Wait a few seconds between downloads to avoid rate limiting
2. **Comment Loading** - Scroll through comments before extracting to load more
3. **Video Quality** - Instagram may serve different quality based on your connection
4. **Organization** - Use a dedicated downloads folder for Instagram content
5. **Backup** - Keep backups of important downloads

## 🙋 FAQ

**Q: Does this work on Instagram Reels?**
A: Currently optimized for regular posts. Reels support may vary.

**Q: Can I download stories?**
A: No, this extension is designed for permanent posts only.

**Q: Will this get my account banned?**
A: Use responsibly. Excessive downloading may trigger Instagram's rate limits.

**Q: Can I use this on mobile?**
A: No, this is a Chrome desktop extension only.

**Q: Does it work with private accounts?**
A: Only if you're logged in and have permission to view the content.

## 🔗 Related Tools

If you need different functionality:
- **Instagram Data Export** - Official Instagram tool for downloading your data
- **DownloadGram** - Web-based Instagram downloaders (use with caution)
- **4K Stogram** - Desktop app for Instagram downloading

---

**Remember:** Always respect content creators' rights and Instagram's Terms of Service. This tool is meant to help you archive and organize content you have legitimate access to. 🙏
