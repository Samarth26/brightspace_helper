#!/bin/bash

# Brightspace LLM Assistant - Installation & Verification Script
# This script verifies your extension is set up correctly

echo "🔍 Brightspace LLM Assistant - Verification Script"
echo "=================================================="
echo ""

# Check if we're in the right directory
if [ ! -f "manifest.json" ]; then
    echo "❌ Error: manifest.json not found in current directory"
    echo "Please run this script from the LMS extension folder:"
    echo "cd /Users/parkhiagarwal/Downloads/LMS"
    exit 1
fi

echo "✓ Found manifest.json"

# Check required files
REQUIRED_FILES=(
    "manifest.json"
    "background.js"
    "content.js"
    "popup.html"
    "popup.js"
    "popup.css"
    "icons/icon16.png"
    "icons/icon48.png"
    "icons/icon128.png"
)

echo ""
echo "Checking required files..."
MISSING_FILES=0

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✓ $file"
    else
        echo "✗ Missing: $file"
        MISSING_FILES=$((MISSING_FILES + 1))
    fi
done

echo ""
if [ $MISSING_FILES -eq 0 ]; then
    echo "✅ All required files present!"
else
    echo "❌ Missing $MISSING_FILES files. Extension might not work properly."
fi

# Verify manifest.json is valid JSON
echo ""
echo "Validating manifest.json..."
if python3 -c "import json; json.load(open('manifest.json'))" 2>/dev/null; then
    echo "✓ manifest.json is valid JSON"
else
    echo "✗ manifest.json has syntax errors"
fi

# Count total lines of code
echo ""
echo "📊 Code Statistics:"
echo ""
TOTAL_LINES=0
for file in *.js *.html *.css; do
    if [ -f "$file" ]; then
        LINES=$(wc -l < "$file")
        TOTAL_LINES=$((TOTAL_LINES + LINES))
        printf "%-20s %4d lines\n" "$file" "$LINES"
    fi
done
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "%-20s %4d lines\n" "TOTAL" "$TOTAL_LINES"

# Check documentation
echo ""
echo "📚 Documentation:"
DOCS=(
    "README.md"
    "QUICKSTART.md"
    "DEBUGGING_GUIDE.md"
    "IMPLEMENTATION_SUMMARY.md"
)

for doc in "${DOCS[@]}"; do
    if [ -f "$doc" ]; then
        echo "✓ $doc"
    else
        echo "✗ Missing: $doc"
    fi
done

# Summary
echo ""
echo "🚀 Installation Instructions:"
echo ""
echo "1. Get your Hugging Face API key:"
echo "   → Visit https://huggingface.co/settings/tokens"
echo "   → Create a new token"
echo ""
echo "2. Accept Llama model terms:"
echo "   → Visit https://huggingface.co/meta-llama/Llama-2-7b-chat-hf"
echo "   → Click 'Agree and access repository'"
echo ""
echo "3. Load extension in Chrome:"
echo "   → Go to chrome://extensions/"
echo "   → Enable 'Developer mode' (top right)"
echo "   → Click 'Load unpacked'"
echo "   → Select this folder: $(pwd)"
echo ""
echo "4. Configure the extension:"
echo "   → Click extension icon in toolbar"
echo "   → Paste your Hugging Face API key"
echo "   → Click 'Save'"
echo ""
echo "5. Start using it:"
echo "   → Go to a Brightspace course page"
echo "   → Click 'Scan This Page'"
echo "   → Ask a question about your course"
echo ""
echo "✨ You're all set! Happy learning!"
echo ""
