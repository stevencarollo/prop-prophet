const fs = require('fs');

// Read index.html
let content = fs.readFileSync('index.html', 'utf8');

// Remove the problematic reload lines
content = content.replace(
    /\/\/ Reload the page to show fresh data\s+setTimeout\(\(\) => location\.reload\(\), 1500\);\s+return;/,
    '// Continue to static refresh below'
);

// Write back
fs.writeFileSync('index.html', content, 'utf8');

console.log('✅ Fixed refresh function - removed page reload');
