#!/bin/bash

# Setup script for Brightspace LLM Assistant Chrome Extension
# Creates necessary icons for the extension

echo "Creating icons directory..."
mkdir -p icons

# Create a simple SVG icon and convert to PNG
# For production, replace these with proper icon files

# Create 16x16 icon
cat > icons/create_icon.svg << 'EOF'
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#grad)" rx="20"/>
  <circle cx="30" cy="30" r="15" fill="white" opacity="0.3"/>
  <circle cx="70" cy="70" r="15" fill="white" opacity="0.2"/>
  
  <!-- Book icon -->
  <path d="M 25 35 L 25 65 Q 25 75 35 75 L 65 75 Q 75 75 75 65 L 75 35 Q 75 25 65 25 L 35 25 Q 25 25 25 35" 
        fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="50" y1="25" x2="50" y2="75" stroke="white" stroke-width="2"/>
  
  <!-- Chat bubble -->
  <circle cx="60" cy="50" r="12" fill="white" opacity="0.9"/>
  <path d="M 68 62 L 75 75 L 65 65" fill="white" opacity="0.9"/>
  <circle cx="62" cy="48" r="1.5" fill="#667eea"/>
  <circle cx="58" cy="48" r="1.5" fill="#667eea"/>
  <circle cx="62" cy="52" r="1.5" fill="#667eea"/>
</svg>
EOF

echo "Icon SVG created at icons/create_icon.svg"
echo ""
echo "To complete the setup, you need to convert the SVG to PNG formats:"
echo "  - 16x16 px  -> icons/icon16.png"
echo "  - 48x48 px  -> icons/icon48.png"
echo "  - 128x128 px -> icons/icon128.png"
echo ""
echo "Options:"
echo "1. Use Figma (free online): Upload the SVG and export at each size"
echo "2. Use ImageMagick: convert -density 1200 icons/create_icon.svg -resize 16x16 icons/icon16.png"
echo "3. Use an online converter: https://convertio.co/svg-png/"
echo ""
echo "Or create placeholder PNG files using this Node.js script:"
echo ""
cat > create_icons.js << 'EOJS'
const fs = require('fs');
const path = require('path');

// This requires canvas or similar library. For now, just create placeholder files.
// In production, use actual icon images.

console.log('Creating placeholder icon files...');

// Create simple PNG placeholders (1x1 transparent pixel)
const sizes = [16, 48, 128];
const pngHeader = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D,                         // IHDR chunk size
  0x49, 0x48, 0x44, 0x52,                         // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89,                                           // IHDR CRC
  0x00, 0x00, 0x00, 0x0A,                         // IDAT chunk size
  0x49, 0x44, 0x41, 0x54,                         // IDAT
  0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB4,      // IDAT data + CRC
  0x00, 0x00, 0x00, 0x00,                         // IEND chunk size
  0x49, 0x45, 0x4E, 0x44,                         // IEND
  0xAE, 0x42, 0x60, 0x82                          // IEND CRC
]);

sizes.forEach(size => {
  const filepath = path.join('icons', `icon${size}.png`);
  fs.writeFileSync(filepath, pngHeader);
  console.log(`Created placeholder: ${filepath}`);
});

console.log('\nNote: These are placeholder icons. Replace with actual icon images.');
EOJS

echo "Run: node create_icons.js"
echo ""
echo "Setup complete! Next steps:"
echo "1. Create/convert icons at the required sizes"
echo "2. Go to chrome://extensions/"
echo "3. Enable Developer mode (top right)"
echo "4. Click 'Load unpacked'"
echo "5. Select this folder"
echo "6. Get your Hugging Face API key and add it to the extension"
