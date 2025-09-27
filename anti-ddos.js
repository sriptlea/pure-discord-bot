// Anti-DDoS Protection Module for Discord Bot
const rateLimit = new Map();
const blockedUsers = new Set();
const suspiciousActivity = new Map();

// Rate limiting configuration
const RATE_LIMITS = {
    generatekey: { max: 3, window: 60000 }, // 3 requests per minute
    blacklist: { max: 5, window: 60000 },   // 5 requests per minute
    lookup: { max: 10, window: 60000 },     // 10 requests per minute
    reset: { max: 5, window: 60000 }        // 5 requests per minute
};

// DDoS detection thresholds
const DDOS_THRESHOLDS = {
    maxRequestsPerMinute: 50,
    maxCommandsPerSecond: 5,
    suspiciousPatternThreshold: 10
};

class AntiDDoS {
    constructor() {
        this.requestCounts = new Map();
        this.commandCounts = new Map();
        this.lastCleanup = Date.now();
        
        // Clean up old entries every 5 minutes
        setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    // Check if user is rate limited for a specific command
    isRateLimited(userId, command) {
        const key = `${userId}-${command}`;
        const now = Date.now();
        const limit = RATE_LIMITS[command];
        
        if (!limit) return false;
        
        if (!rateLimit.has(key)) {
            rateLimit.set(key, { count: 1, resetTime: now + limit.window });
            return false;
        }
        
        const userLimit = rateLimit.get(key);
        
        if (now > userLimit.resetTime) {
            userLimit.count = 1;
            userLimit.resetTime = now + limit.window;
            return false;
        }
        
        if (userLimit.count >= limit.max) {
            this.logSuspiciousActivity(userId, `Rate limit exceeded for ${command}`);
            return true;
        }
        
        userLimit.count++;
        return false;
    }

    // Check for DDoS patterns
    checkDDoSPattern(userId) {
        if (blockedUsers.has(userId)) {
            return true;
        }

        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const oneSecondAgo = now - 1000;

        // Initialize counters if not exists
        if (!this.requestCounts.has(userId)) {
            this.requestCounts.set(userId, []);
        }
        if (!this.commandCounts.has(userId)) {
            this.commandCounts.set(userId, []);
        }

        // Add current request
        this.requestCounts.get(userId).push(now);
        this.commandCounts.get(userId).push(now);

        // Filter recent requests
        const recentRequests = this.requestCounts.get(userId).filter(time => time > oneMinuteAgo);
        const recentCommands = this.commandCounts.get(userId).filter(time => time > oneSecondAgo);

        // Update arrays
        this.requestCounts.set(userId, recentRequests);
        this.commandCounts.set(userId, recentCommands);

        // Check thresholds
        if (recentRequests.length > DDOS_THRESHOLDS.maxRequestsPerMinute) {
            this.blockUser(userId, `Too many requests per minute: ${recentRequests.length}`);
            return true;
        }

        if (recentCommands.length > DDOS_THRESHOLDS.maxCommandsPerSecond) {
            this.blockUser(userId, `Too many commands per second: ${recentCommands.length}`);
            return true;
        }

        return false;
    }

    // Log suspicious activity
    logSuspiciousActivity(userId, reason) {
        const now = Date.now();
        
        if (!suspiciousActivity.has(userId)) {
            suspiciousActivity.set(userId, []);
        }
        
        suspiciousActivity.get(userId).push({ reason, timestamp: now });
        
        // Check if user has too many suspicious activities
        const recentActivity = suspiciousActivity.get(userId)
            .filter(activity => now - activity.timestamp < 300000); // 5 minutes
        
        if (recentActivity.length >= DDOS_THRESHOLDS.suspiciousPatternThreshold) {
            this.blockUser(userId, `Suspicious activity pattern detected: ${recentActivity.length} incidents`);
        }
        
        console.log(`[ANTI-DDOS] Suspicious activity from ${userId}: ${reason}`);
    }

    // Block a user temporarily
    blockUser(userId, reason) {
        blockedUsers.add(userId);
        console.log(`[ANTI-DDOS] Blocked user ${userId}: ${reason}`);
        
        // Auto-unblock after 30 minutes
        setTimeout(() => {
            blockedUsers.delete(userId);
            console.log(`[ANTI-DDOS] Auto-unblocked user ${userId}`);
        }, 30 * 60 * 1000);
    }

    // Manually unblock a user (for admins)
    unblockUser(userId) {
        if (blockedUsers.has(userId)) {
            blockedUsers.delete(userId);
            console.log(`[ANTI-DDOS] Manually unblocked user ${userId}`);
            return true;
        }
        return false;
    }

    // Check if user is blocked
    isBlocked(userId) {
        return blockedUsers.has(userId);
    }

    // Get user stats
    getUserStats(userId) {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        
        const requests = this.requestCounts.get(userId) || [];
        const recentRequests = requests.filter(time => time > oneMinuteAgo);
        
        const suspicious = suspiciousActivity.get(userId) || [];
        const recentSuspicious = suspicious.filter(activity => now - activity.timestamp < 300000);
        
        return {
            recentRequests: recentRequests.length,
            suspiciousActivities: recentSuspicious.length,
            isBlocked: this.isBlocked(userId),
            rateLimits: Object.keys(RATE_LIMITS).map(cmd => ({
                command: cmd,
                isLimited: this.isRateLimited(userId, cmd)
            }))
        };
    }

    // Cleanup old entries
    cleanup() {
        const now = Date.now();
        const fiveMinutesAgo = now - 300000;
        
        // Clean up rate limits
        for (const [key, value] of rateLimit.entries()) {
            if (now > value.resetTime) {
                rateLimit.delete(key);
            }
        }
        
        // Clean up request counts
        for (const [userId, timestamps] of this.requestCounts.entries()) {
            const filtered = timestamps.filter(time => time > fiveMinutesAgo);
            if (filtered.length === 0) {
                this.requestCounts.delete(userId);
            } else {
                this.requestCounts.set(userId, filtered);
            }
        }
        
        // Clean up command counts
        for (const [userId, timestamps] of this.commandCounts.entries()) {
            const filtered = timestamps.filter(time => time > fiveMinutesAgo);
            if (filtered.length === 0) {
                this.commandCounts.delete(userId);
            } else {
                this.commandCounts.set(userId, filtered);
            }
        }
        
        // Clean up suspicious activity
        for (const [userId, activities] of suspiciousActivity.entries()) {
            const filtered = activities.filter(activity => now - activity.timestamp < fiveMinutesAgo);
            if (filtered.length === 0) {
                suspiciousActivity.delete(userId);
            } else {
                suspiciousActivity.set(userId, filtered);
            }
        }
        
        console.log(`[ANTI-DDOS] Cleanup completed. Active tracking: ${this.requestCounts.size} users`);
    }

    // Get system stats
    getSystemStats() {
        return {
            trackedUsers: this.requestCounts.size,
            blockedUsers: blockedUsers.size,
            activeRateLimits: rateLimit.size,
            suspiciousActivities: suspiciousActivity.size,
            uptime: Date.now() - this.lastCleanup
        };
    }
}

module.exports = { AntiDDoS, blockedUsers };
