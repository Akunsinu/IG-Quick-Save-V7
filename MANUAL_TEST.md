# Manual Test - Find Media on Page

If the extension can't find media, run this diagnostic to see what's actually on the Instagram page.

## Step 1: Open Instagram Post

1. Go to any Instagram post (e.g., `https://www.instagram.com/p/C0xZAL2Jjb3/`)
2. **Wait 10 seconds** for the page to fully load
3. Make sure you can **see the image/video** on screen

## Step 2: Run Diagnostic

Open Console (F12) and paste this:

```javascript
// MEDIA DIAGNOSTIC
console.log('=== MEDIA DIAGNOSTIC ===');

// Check all possible selectors
const selectors = {
  'article img': document.querySelectorAll('article img'),
  'main img': document.querySelectorAll('main img'),
  'img (all)': document.querySelectorAll('img'),
  'article video': document.querySelectorAll('article video'),
  'main video': document.querySelectorAll('main video'),
  'video (all)': document.querySelectorAll('video')
};

for (const [name, elements] of Object.entries(selectors)) {
  console.log(`${name}: ${elements.length} found`);
  if (elements.length > 0 && elements.length <= 5) {
    Array.from(elements).forEach((el, i) => {
      console.log(`  [${i}] src:`, el.src?.substring(0, 80));
      console.log(`      size: ${el.width}x${el.height}`);
    });
  }
}

// Check if images have loaded
const images = document.querySelectorAll('img');
console.log(`\nTotal images: ${images.length}`);
const loadedImages = Array.from(images).filter(img => img.complete && img.naturalWidth > 0);
console.log(`Loaded images: ${loadedImages.length}`);

// Find largest images (likely post content)
const largeImages = Array.from(images)
  .filter(img => img.naturalWidth >= 300 || img.width >= 300)
  .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));

console.log(`\nLarge images (300px+): ${largeImages.length}`);
if (largeImages.length > 0) {
  console.log('Largest image:', {
    src: largeImages[0].src?.substring(0, 80) + '...',
    size: `${largeImages[0].naturalWidth}x${largeImages[0].naturalHeight}`,
    srcset: largeImages[0].srcset ? 'yes' : 'no'
  });
}

console.log('=== END DIAGNOSTIC ===');
```

## Step 3: Interpret Results

### ✅ Good (Extension Should Work):
```
article img: 1 found
  [0] src: https://instagram...
      size: 1080x1350
```
**Solution**: Reload extension and try again

### ⚠️ Images Found But Wrong Selector:
```
article img: 0 found
main img: 3 found
```
**Solution**: Extension needs update (let me know which selector works)

### ❌ No Images Found:
```
img (all): 0 found
```
**Possible causes**:
1. Page not loaded - Wait longer and run again
2. Instagram changed their layout
3. Network issue - Check if images load in browser

## Step 4: Manual Download (Workaround)

If diagnostic shows images exist but extension can't find them:

```javascript
// MANUAL DOWNLOAD
const images = Array.from(document.querySelectorAll('img'))
  .filter(img => img.naturalWidth >= 300);

console.log('Found', images.length, 'images');

images.forEach((img, i) => {
  // Get highest res URL
  let url = img.src;
  if (img.srcset) {
    const srcsetUrls = img.srcset.split(',').map(s => {
      const [u, w] = s.trim().split(' ');
      return { url: u, width: parseInt(w) || 0 };
    }).sort((a, b) => b.width - a.width);
    if (srcsetUrls.length > 0) url = srcsetUrls[0].url;
  }

  console.log(`Image ${i+1}:`, url);

  // Download (copy URL and paste in new tab to save)
});
```

## Common Issues

### Issue: "0 images found" but I can see the image
- **Cause**: Dynamic loading
- **Fix**: Wait 10+ seconds, scroll to image, run diagnostic again

### Issue: Only profile pics found (32x32)
- **Cause**: Post content not loaded
- **Fix**: Refresh page, wait for full load

### Issue: Images found but download fails
- **Cause**: Different Instagram layout/structure
- **Fix**: Send me the diagnostic output

---

**Next Steps**: Run the diagnostic and send me the output! I'll update the extension to work with your Instagram layout.
