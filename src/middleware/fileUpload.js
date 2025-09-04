// middleware/fileUpload.js - Forum File Upload Handler
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ValidationError } = require('./errorHandler');

class FileUploadService {
  constructor() {
    // Allowed file types for forum attachments
    this.allowedMimeTypes = {
      // Images
      'image/jpeg': { ext: '.jpg', category: 'image' },
      'image/png': { ext: '.png', category: 'image' },
      'image/gif': { ext: '.gif', category: 'image' },
      'image/webp': { ext: '.webp', category: 'image' },
      
      // Documents
      'application/pdf': { ext: '.pdf', category: 'document' },
      'text/plain': { ext: '.txt', category: 'document' },
      'text/markdown': { ext: '.md', category: 'document' },
      
      // Compressed files (for sharing research data)
      'application/zip': { ext: '.zip', category: 'archive' },
      'application/x-7z-compressed': { ext: '.7z', category: 'archive' }
    };

    // File size limits (in bytes)
    this.fileLimits = {
      image: 10 * 1024 * 1024,      // 10MB for images
      document: 25 * 1024 * 1024,   // 25MB for documents  
      archive: 50 * 1024 * 1024,    // 50MB for archives
      default: 10 * 1024 * 1024     // 10MB default
    };

    // Upload directory
    this.uploadDir = path.join(process.cwd(), 'uploads', 'forum');
    this.ensureUploadDirectory();
  }

  // Ensure upload directories exist
  ensureUploadDirectory() {
    const dirs = [
      this.uploadDir,
      path.join(this.uploadDir, 'images'),
      path.join(this.uploadDir, 'documents'),
      path.join(this.uploadDir, 'archives')
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created upload directory: ${dir}`);
      }
    });
  }

  // Generate secure filename
  generateSecureFilename(originalName, userId) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext)
      .replace(/[^a-zA-Z0-9\-_]/g, '') // Remove special chars
      .substring(0, 20); // Limit length
    
    return `${userId}_${timestamp}_${baseName}_${random}${ext}`;
  }

  // Get file category and validate
  validateFile(file) {
    const fileInfo = this.allowedMimeTypes[file.mimetype];
    
    if (!fileInfo) {
      throw new ValidationError(`File type ${file.mimetype} not allowed. Allowed types: images (JPG, PNG, GIF, WebP), documents (PDF, TXT, MD), archives (ZIP, 7Z)`);
    }

    const sizeLimit = this.fileLimits[fileInfo.category] || this.fileLimits.default;
    
    if (file.size > sizeLimit) {
      const sizeMB = Math.round(sizeLimit / (1024 * 1024));
      throw new ValidationError(`File too large. Maximum size for ${fileInfo.category} files: ${sizeMB}MB`);
    }

    return fileInfo;
  }

  // Get storage configuration
  getStorageConfig() {
    return multer.diskStorage({
      destination: (req, file, cb) => {
        try {
          const fileInfo = this.validateFile(file);
          const destDir = path.join(this.uploadDir, `${fileInfo.category}s`);
          cb(null, destDir);
        } catch (error) {
          cb(error);
        }
      },
      
      filename: (req, file, cb) => {
        try {
          const userId = req.user?.id || 'anonymous';
          const secureFilename = this.generateSecureFilename(file.originalname, userId);
          
          // Store file info for later use
          file.secureFilename = secureFilename;
          file.category = this.allowedMimeTypes[file.mimetype].category;
          
          cb(null, secureFilename);
        } catch (error) {
          cb(error);
        }
      }
    });
  }

  // File filter for additional validation
  fileFilter(req, file, cb) {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return cb(new ValidationError('Authentication required for file uploads'));
      }

      // Validate file type and size
      const fileInfo = this.validateFile(file);
      
      // Additional security checks
      const originalName = file.originalname.toLowerCase();
      const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com', '.js', '.vbs', '.jar'];
      
      const isDangerous = dangerousExtensions.some(ext => originalName.endsWith(ext));
      if (isDangerous) {
        return cb(new ValidationError('Executable files are not allowed'));
      }

      cb(null, true);
    } catch (error) {
      cb(error);
    }
  }
}

// Initialize the service
const uploadService = new FileUploadService();

// Create multer middleware with custom configuration
const uploadMiddleware = multer({
  storage: uploadService.getStorageConfig(),
  fileFilter: uploadService.fileFilter.bind(uploadService),
  limits: {
    fileSize: Math.max(...Object.values(uploadService.fileLimits)), // Use largest limit
    files: 5, // Maximum 5 files per request
    fieldSize: 1024 * 1024 // 1MB field size limit
  }
});

// Middleware to process uploaded files and add metadata
const processUploads = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next();
  }

  try {
    // Add metadata to each file
    req.files = req.files.map(file => {
      const fileUrl = `/uploads/forum/${file.category}s/${file.filename}`;
      
      return {
        fieldname: file.fieldname,
        originalname: file.originalname,
        encoding: file.encoding,
        mimetype: file.mimetype,
        filename: file.filename,
        path: file.path,
        size: file.size,
        category: file.category,
        url: fileUrl,
        secure: true, // Files are validated and safe
        uploadedAt: new Date(),
        uploadedBy: req.user.id
      };
    });

    // Log successful uploads
    console.log(`📎 ${req.files.length} file(s) uploaded by user ${req.user.username}:`, 
      req.files.map(f => ({ name: f.originalname, size: f.size, type: f.mimetype }))
    );

    next();
  } catch (error) {
    next(error);
  }
};

// Error handling middleware specifically for multer errors
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return next(new ValidationError('File too large'));
      case 'LIMIT_FILE_COUNT':
        return next(new ValidationError('Too many files. Maximum 5 files allowed'));
      case 'LIMIT_UNEXPECTED_FILE':
        return next(new ValidationError('Unexpected file field'));
      case 'LIMIT_FIELD_VALUE':
        return next(new ValidationError('Field value too large'));
      default:
        return next(new ValidationError(`Upload error: ${error.message}`));
    }
  }
  
  next(error);
};

// Helper function to delete uploaded files (for cleanup on error)
const cleanupFiles = (files) => {
  if (!files || !Array.isArray(files)) return;
  
  files.forEach(file => {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
        console.log(`🗑️ Cleaned up file: ${file.filename}`);
      }
    } catch (error) {
      console.error(`Failed to cleanup file ${file.filename}:`, error);
    }
  });
};

// Combine middleware functions for easy use
const fileUploadChain = [
  uploadMiddleware,
  handleUploadError,
  processUploads
];

// Export individual functions and combined chain
module.exports = {
  // Main upload middleware (use this in routes)
  single: (fieldname) => [
    uploadMiddleware.single(fieldname),
    handleUploadError,
    processUploads
  ],
  
  array: (fieldname, maxCount = 3) => [
    uploadMiddleware.array(fieldname, maxCount),
    handleUploadError,
    processUploads
  ],
  
  fields: (fields) => [
    uploadMiddleware.fields(fields),
    handleUploadError,
    processUploads
  ],
  
  // Utility functions
  cleanupFiles,
  uploadService,
  
  // For backward compatibility
  ...fileUploadChain
};