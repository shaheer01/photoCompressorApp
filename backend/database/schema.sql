-- ImageOptim Production Database Schema
-- MySQL Database Setup

-- Users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_premium BOOLEAN DEFAULT FALSE,
    subscription_type VARCHAR(20) DEFAULT NULL, -- 'monthly', 'yearly', null
    subscription_id VARCHAR(255) DEFAULT NULL, -- Stripe subscription ID
    subscription_start_date TIMESTAMP NULL DEFAULT NULL,
    subscription_end_date TIMESTAMP NULL DEFAULT NULL,
    stripe_customer_id VARCHAR(255) DEFAULT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255) DEFAULT NULL,
    password_reset_token VARCHAR(255) DEFAULT NULL,
    password_reset_expires TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL DEFAULT NULL,
    login_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

-- User sessions table (for JWT token management)
CREATE TABLE user_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    token_hash VARCHAR(255) NOT NULL,
    device_info TEXT,
    ip_address VARCHAR(45), -- Changed from INET to VARCHAR for IPv4/IPv6
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Image processing logs table
CREATE TABLE image_processing_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    session_id VARCHAR(255), -- For anonymous users
    original_filename VARCHAR(255) NOT NULL,
    original_size_bytes BIGINT NOT NULL,
    compressed_size_bytes BIGINT NOT NULL,
    compression_ratio DECIMAL(5,2) NOT NULL,
    quality_setting INT NOT NULL,
    processing_time_ms INT NOT NULL,
    compression_method VARCHAR(50) NOT NULL, -- 'compressorjs', 'canvas', 'direct'
    user_agent TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Subscription transactions table
CREATE TABLE subscription_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    stripe_payment_intent_id VARCHAR(255) NOT NULL,
    stripe_subscription_id VARCHAR(255),
    amount_cents INT NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    subscription_type VARCHAR(20) NOT NULL, -- 'monthly', 'yearly'
    status VARCHAR(50) NOT NULL, -- 'pending', 'succeeded', 'failed', 'cancelled'
    stripe_invoice_id VARCHAR(255),
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Usage statistics table
CREATE TABLE usage_statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    date DATE NOT NULL,
    images_processed INT DEFAULT 0,
    total_original_size_mb DECIMAL(10,2) DEFAULT 0,
    total_compressed_size_mb DECIMAL(10,2) DEFAULT 0,
    total_savings_mb DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_date (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Admin settings table
CREATE TABLE admin_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT,
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX idx_image_processing_logs_user_id ON image_processing_logs(user_id);
CREATE INDEX idx_image_processing_logs_created_at ON image_processing_logs(created_at);
CREATE INDEX idx_subscription_transactions_user_id ON subscription_transactions(user_id);
CREATE INDEX idx_usage_statistics_user_date ON usage_statistics(user_id, date);

-- Insert default admin settings
INSERT INTO admin_settings (setting_key, setting_value, description) VALUES
('max_file_size_free_mb', '10', 'Maximum file size for free users in MB'),
('max_file_size_premium_mb', '100', 'Maximum file size for premium users in MB'),
('max_files_per_batch_free', '5', 'Maximum files per batch for free users'),
('max_files_per_batch_premium', '50', 'Maximum files per batch for premium users'),
('stripe_monthly_price_id', 'price_monthly_placeholder', 'Stripe price ID for monthly subscription'),
('stripe_yearly_price_id', 'price_yearly_placeholder', 'Stripe price ID for yearly subscription'),
('monthly_price_cents', '999', 'Monthly subscription price in cents'),
('yearly_price_cents', '9999', 'Yearly subscription price in cents');