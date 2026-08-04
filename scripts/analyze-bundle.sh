#!/bin/bash
# Bundle analysis script — generates a bundle report using webpack-bundle-analyzer
# Usage: bash scripts/analyze-bundle.sh

cd /home/z/my-project

echo "=== Bundle Analysis ==="
echo "Analyzing bundle size for all chunks..."

# Check if webpack-bundle-analyzer is available
if ! bun pm ls 2>/dev/null | grep -q "webpack-bundle-analyzer"; then
  echo "Installing webpack-bundle-analyzer..."
  bun add -d webpack-bundle-analyzer 2>/dev/null || npm install --save-dev webpack-bundle-analyzer 2>/dev/null
fi

# Run build with analysis
echo "Running build with bundle analysis..."
ANALYZE=true NODE_OPTIONS="--max-old-space-size=3072" bun run build 2>&1 | tee /tmp/bundle-analysis.log

echo ""
echo "=== Bundle Analysis Complete ==="
echo "Check .next/analyze/ for the report"
echo ""
echo "Bundle size summary:"
du -sh .next/static/chunks/*.js 2>/dev/null | sort -rh | head -20
