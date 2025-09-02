#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Configuration
const OUTPUT_FILE = 'backend-combined.txt';
const ROOT_DIR = process.cwd();

// File extensions to include
const INCLUDE_EXTENSIONS = [
  '.js', '.ts', '.tsx', '.jsx', '.json', '.md', '.env.example', 
  '.sql', '.html', '.css', '.scss', '.yaml', '.yml', '.txt',
  '.gitignore', '.eslintrc', '.babelrc', '.prettierrc'
];

// Directories to exclude
const EXCLUDE_DIRS = [
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.nyc_output', 'logs', 'tmp', 'temp', '.cache', '.vscode',
  '.idea', 'bower_components'
];

// Files to exclude
const EXCLUDE_FILES = [
  '.env', '.env.local', '.env.production', '.env.development',
  'package-lock.json', 'yarn.lock', '.DS_Store', 'Thumbs.db',
  'npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*'
];

// Check if file should be included
function shouldIncludeFile(filePath, fileName) {
  // Check if file is in exclude list
  if (EXCLUDE_FILES.includes(fileName)) return false;
  
  // Check if any part of the path contains excluded directories
  const pathParts = filePath.split(path.sep);
  if (pathParts.some(part => EXCLUDE_DIRS.includes(part))) return false;
  
  // Check file extension
  const ext = path.extname(fileName);
  return INCLUDE_EXTENSIONS.includes(ext) || fileName.startsWith('.') && !fileName.includes('.');
}

// Get all files recursively
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(file)) {
        getAllFiles(filePath, fileList);
      }
    } else {
      if (shouldIncludeFile(filePath, file)) {
        fileList.push(filePath);
      }
    }
  });
  
  return fileList;
}

// Get relative path from root
function getRelativePath(filePath) {
  return path.relative(ROOT_DIR, filePath);
}

// Group files by directory
function groupFilesByDirectory(files) {
  const grouped = {};
  
  files.forEach(file => {
    const relativePath = getRelativePath(file);
    const dir = path.dirname(relativePath);
    
    if (!grouped[dir]) {
      grouped[dir] = [];
    }
    
    grouped[dir].push({
      fullPath: file,
      relativePath: relativePath,
      fileName: path.basename(file)
    });
  });
  
  return grouped;
}

// Read file content safely
function readFileContent(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content;
  } catch (error) {
    return `// Error reading file: ${error.message}`;
  }
}

// Main function
function combineFiles() {
  console.log('🔍 Scanning backend repository...');
  
  const allFiles = getAllFiles(ROOT_DIR);
  const groupedFiles = groupFilesByDirectory(allFiles);
  
  console.log(`📁 Found ${allFiles.length} files to combine`);
  
  let output = '';
  output += `BACKEND REPOSITORY CODE COMBINATION\n`;
  output += `Generated: ${new Date().toISOString()}\n`;
  output += `Total Files: ${allFiles.length}\n`;
  output += `${'='.repeat(80)}\n\n`;
  
  // Sort directories for consistent output
  const sortedDirs = Object.keys(groupedFiles).sort();
  
  sortedDirs.forEach(dir => {
    const files = groupedFiles[dir];
    
    output += `\n${'='.repeat(60)}\n`;
    output += `DIRECTORY: ${dir}\n`;
    output += `${'='.repeat(60)}\n\n`;
    
    // Sort files within directory
    files.sort((a, b) => a.fileName.localeCompare(b.fileName));
    
    files.forEach(file => {
      output += `// === ${file.relativePath} ===\n`;
      
      const content = readFileContent(file.fullPath);
      output += content;
      
      if (!content.endsWith('\n')) {
        output += '\n';
      }
      
      output += `\n// === END ${file.relativePath} ===\n\n`;
    });
  });
  
  // Write output file
  fs.writeFileSync(OUTPUT_FILE, output);
  
  console.log(`✅ Backend code combined successfully!`);
  console.log(`📄 Output file: ${OUTPUT_FILE}`);
  console.log(`📊 File size: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2)} KB`);
  console.log('\n🚀 Ready to copy and paste into a gist!');
}

// Run the script
if (require.main === module) {
  try {
    combineFiles();
  } catch (error) {
    console.error('❌ Error combining files:', error.message);
    process.exit(1);
  }
}