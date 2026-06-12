const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function initDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('📦 Creating database tables...');
    
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(20) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(50) NOT NULL,
        avatar_url VARCHAR(255) DEFAULT '/avatars/default1.svg',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    
    // User stats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_stats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        total_points INTEGER DEFAULT 0,
        uno_count INTEGER DEFAULT 0,
        catch_uno_count INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        session_token VARCHAR(255) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT
      )
    `);
    
    // Game history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_history (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(20) NOT NULL,
        winner_id INTEGER REFERENCES users(id),
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        total_turns INTEGER,
        game_duration INTEGER
      )
    `);
    
    // Game players table
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_players (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES game_history(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        is_bot BOOLEAN DEFAULT FALSE,
        bot_name VARCHAR(50),
        final_score INTEGER DEFAULT 0,
        position INTEGER,
        cards_played INTEGER DEFAULT 0,
        uno_called BOOLEAN DEFAULT FALSE
      )
    `);
    
    // Chat history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(20) NOT NULL,
        user_id INTEGER REFERENCES users(id),
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Friend requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id SERIAL PRIMARY KEY,
        from_user_id INTEGER REFERENCES users(id),
        to_user_id INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(from_user_id, to_user_id)
      )
    `);
    
    // Friends table
    await client.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        friend_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, friend_id)
      )
    `);
    
    // Achievements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        icon VARCHAR(50),
        required_wins INTEGER DEFAULT 0,
        required_games INTEGER DEFAULT 0,
        required_uno INTEGER DEFAULT 0
      )
    `);
    
    // User achievements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        achievement_id INTEGER REFERENCES achievements(id),
        earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, achievement_id)
      )
    `);
    
    // Insert default achievements
    await client.query(`
      INSERT INTO achievements (name, description, icon, required_wins, required_games, required_uno)
      VALUES 
        ('Birinchi g\'alaba', 'Birinchi marta g\'olib bo\'ling', '🏆', 1, 0, 0),
        ('UNO Ustasi', '10 marta UNO deb ayting', '🎴', 0, 0, 10),
        ('Chempion', '50 ta g\'alaba', '👑', 50, 0, 0),
        ('Tajribali O\'yinchi', '100 ta o\'yin o\'ynang', '⭐', 0, 100, 0),
        ('Ketma-ket G\'alaba', '3 ta o\'yinni ketma-ket yuting', '🔥', 3, 0, 0),
        ('Jumper', 'Jump-In qiling', '⚡', 0, 0, 0)
      ON CONFLICT (name) DO NOTHING
    `);
    
    console.log('✅ Database initialized successfully!');
    
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase();