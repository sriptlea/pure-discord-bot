const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { AntiDDoS } = require('./anti-ddos');

// Configuration
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const BUYER_ROLE_ID = process.env.BUYER_ROLE_ID || '1421282906625806386';
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || '1421282676668895273';
const DATABASE_PATH = process.env.DATABASE_PATH || './pure.db';

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Initialize Anti-DDoS protection
const antiDDoS = new AntiDDoS();

// Initialize database
const db = new sqlite3.Database(DATABASE_PATH);

// Helper functions
function generateKey() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9).toUpperCase();
    return `PURE-${timestamp}-${random}`;
}

function hasRequiredRole(member, roleId) {
    return member.roles.cache.has(roleId);
}

function createEmbed(title, description, color = 0x7C3AED) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Pure Bot', iconURL: client.user?.displayAvatarURL() });
}

// Database operations
function getUserByDiscordId(discordId) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM users_extended WHERE discord_id = ?',
            [discordId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM users_local WHERE username = ?',
            [username],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

function createProductKey(keyValue, discordId) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO product_keys (key_value, user_id, status, created_at) VALUES (?, ?, "approved", datetime("now"))',
            [keyValue, discordId],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

function blacklistUser(username) {
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users_local SET is_active = 0 WHERE username = ?',
            [username],
            function(err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            }
        );
    });
}

function resetUserCredentials(username) {
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users_local SET hwid = NULL, password_hash = NULL WHERE username = ?',
            [username],
            function(err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            }
        );
    });
}

function addDiscordUser(discordId, username) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT OR REPLACE INTO discord_users (discord_id, username, updated_at) VALUES (?, ?, datetime("now"))',
            [discordId, username],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

// Commands
const commands = [
    new SlashCommandBuilder()
        .setName('generatekey')
        .setDescription('Generate a license key for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Discord user to generate key for')
                .setRequired(true)
        ),
    
    new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Blacklist a username')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Username to blacklist')
                .setRequired(true)
        ),
    
    new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Look up user information')
        .addUserOption(option =>
            option.setName('discord_user')
                .setDescription('Discord user to lookup')
        )
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Website username to lookup')
        ),
    
    new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Reset user credentials (HWID and password)')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Username to reset')
                .setRequired(true)
        ),
    
    new SlashCommandBuilder()
        .setName('unblock')
        .setDescription('Unblock a user from anti-DDoS protection')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Discord user to unblock')
                .setRequired(true)
        ),
    
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View anti-DDoS system statistics')
];

// Register commands
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
}

// Event handlers
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('Pure - Premium Tools', { type: 'WATCHING' });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member, user } = interaction;
    
    // Anti-DDoS protection
    if (antiDDoS.isBlocked(user.id)) {
        const embed = createEmbed(
            '🚫 Blocked',
            'You have been temporarily blocked due to suspicious activity. Please try again later.',
            0xFF0000
        );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Check for DDoS patterns
    if (antiDDoS.checkDDoSPattern(user.id)) {
        const embed = createEmbed(
            '🚫 Rate Limited',
            'Too many requests detected. You have been temporarily blocked.',
            0xFF0000
        );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Rate limiting for specific commands
    if (['generatekey', 'blacklist', 'lookup', 'reset'].includes(commandName)) {
        if (antiDDoS.isRateLimited(user.id, commandName)) {
            const embed = createEmbed(
                '⏰ Rate Limited',
                `You are using the ${commandName} command too frequently. Please wait before trying again.`,
                0xFFAA00
            );
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    // Check if user has required role
    if (!hasRequiredRole(member, ADMIN_ROLE_ID)) {
        const embed = createEmbed(
            '❌ Access Denied',
            'You do not have permission to use this command.',
            0xFF0000
        );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
        switch (commandName) {
            case 'generatekey': {
                const targetUser = interaction.options.getUser('user');
                
                // Generate key
                const keyValue = generateKey();
                
                // Store in database
                await createProductKey(keyValue, targetUser.id);
                await addDiscordUser(targetUser.id, targetUser.username);
                
                // Send DM to target user
                try {
                    const dmEmbed = createEmbed(
                        '🔑 Your Pure License Key',
                        `Hello ${targetUser.username}!\n\nYour Pure license key has been generated:\n\`\`\`${keyValue}\`\`\`\n\n**Instructions:**\n1. Use this key to register on the Pure website\n2. Download the Pure loader\n3. Enter your credentials in the console application\n\n*Keep this key secure and do not share it with others.*`,
                        0x00FF00
                    );
                    
                    await targetUser.send({ embeds: [dmEmbed] });
                    
                    const successEmbed = createEmbed(
                        '✅ Key Generated Successfully',
                        `License key generated and sent to ${targetUser.username}\nKey: \`${keyValue}\``,
                        0x00FF00
                    );
                    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
                } catch (dmError) {
                    console.error('Failed to send DM:', dmError);
                    const embed = createEmbed(
                        '⚠️ Key Generated (DM Failed)',
                        `License key generated: \`${keyValue}\`\nCould not send DM to ${targetUser.username}. Please share the key manually.`,
                        0xFFAA00
                    );
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                }
                break;
            }

            case 'blacklist': {
                const username = interaction.options.getString('username');
                
                const success = await blacklistUser(username);
                
                if (success) {
                    const embed = createEmbed(
                        '✅ User Blacklisted',
                        `Successfully blacklisted user: \`${username}\``,
                        0x00FF00
                    );
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                } else {
                    const embed = createEmbed(
                        '❌ User Not Found',
                        `Could not find user: \`${username}\``,
                        0xFF0000
                    );
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                }
                break;
            }

            case 'lookup': {
                const discordUser = interaction.options.getUser('discord_user');
                const username = interaction.options.getString('username');
                
                if (discordUser) {
                    // Lookup by Discord user
                    const user = await getUserByDiscordId(discordUser.id);
                    
                    if (user) {
                        const embed = createEmbed(
                            '👤 User Information',
                            `**Discord:** ${discordUser.username}\n**User ID:** ${user.user_id}\n**Admin:** ${user.is_admin ? 'Yes' : 'No'}\n**HWID:** ${user.hwid || 'Not set'}\n**Created:** ${new Date(user.created_at).toLocaleDateString()}`,
                            0x7C3AED
                        );
                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    } else {
                        const embed = createEmbed(
                            '❌ User Not Found',
                            `No website account found for Discord user: ${discordUser.username}`,
                            0xFF0000
                        );
                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    }
                } else if (username) {
                    // Lookup by username
                    const user = await getUserByUsername(username);
                    
                    if (user) {
                        const embed = createEmbed(
                            '👤 User Information',
                            `**Username:** ${user.username}\n**License Key:** ${user.license_key}\n**HWID:** ${user.hwid || 'Not set'}\n**Active:** ${user.is_active ? 'Yes' : 'No'}\n**Discord ID:** ${user.discord_id || 'Not linked'}\n**Created:** ${new Date(user.created_at).toLocaleDateString()}`,
                            0x7C3AED
                        );
                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    } else {
                        const embed = createEmbed(
                            '❌ User Not Found',
                            `Could not find user: \`${username}\``,
                            0xFF0000
                        );
                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    }
                } else {
                    const embed = createEmbed(
                        '❌ Invalid Parameters',
                        'Please provide either a Discord user or username to lookup.',
                        0xFF0000
                    );
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                }
                break;
            }

            case 'reset': {
                const username = interaction.options.getString('username');
                
                // Check if user has buyer role for reset command
                if (!hasRequiredRole(member, BUYER_ROLE_ID) && !hasRequiredRole(member, ADMIN_ROLE_ID)) {
                    const embed = createEmbed(
                        '❌ Access Denied',
                        'You need buyer role or higher to use the reset command.',
                        0xFF0000
                    );
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                
                const success = await resetUserCredentials(username);
                
                if (success) {
                    const embed = createEmbed(
                        '✅ User Reset Successfully',
                        `Successfully reset credentials for user: \`${username}\`\nHWID and password have been cleared.`,
                        0x00FF00
                    );
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                } else {
                    const embed = createEmbed(
                        '❌ User Not Found',
                        `Could not find user: \`${username}\``,
                        0xFF0000
                    );
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                }
                break;
            }

            case 'unblock': {
                const targetUser = interaction.options.getUser('user');
                
                if (antiDDoS.unblockUser(targetUser.id)) {
                    const embed = createEmbed(
                        '✅ User Unblocked',
                        `Successfully unblocked ${targetUser.username} from anti-DDoS protection.`,
                        0x00FF00
                    );
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                } else {
                    const embed = createEmbed(
                        '❌ User Not Blocked',
                        `${targetUser.username} is not currently blocked.`,
                        0xFF0000
                    );
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                }
                break;
            }

            case 'stats': {
                const systemStats = antiDDoS.getSystemStats();
                const userStats = antiDDoS.getUserStats(user.id);
                
                const embed = createEmbed(
                    '📊 Anti-DDoS Statistics',
                    `**System Stats:**\n` +
                    `• Tracked Users: ${systemStats.trackedUsers}\n` +
                    `• Blocked Users: ${systemStats.blockedUsers}\n` +
                    `• Active Rate Limits: ${systemStats.activeRateLimits}\n` +
                    `• Suspicious Activities: ${systemStats.suspiciousActivities}\n\n` +
                    `**Your Stats:**\n` +
                    `• Recent Requests: ${userStats.recentRequests}/min\n` +
                    `• Suspicious Activities: ${userStats.suspiciousActivities}\n` +
                    `• Status: ${userStats.isBlocked ? '🚫 Blocked' : '✅ Active'}`,
                    0x7C3AED
                );
                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }

            default:
                const embed = createEmbed(
                    '❌ Unknown Command',
                    'This command is not recognized.',
                    0xFF0000
                );
                await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    } catch (error) {
        console.error('Command execution error:', error);
        const embed = createEmbed(
            '❌ Error',
            'An error occurred while executing the command.',
            0xFF0000
        );
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// Error handling
client.on('error', console.error);

// Login and register commands
registerCommands().then(() => {
    client.login(TOKEN);
});
