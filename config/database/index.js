const SqliteDatabase = require('./sqlite');

let sharedInstance = null;

function createDatabase() {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
        const PostgresDatabase = require('./postgres');
        return new PostgresDatabase();
    }
    return new SqliteDatabase();
}

class Database {
    constructor() {
        if (!sharedInstance) {
            sharedInstance = createDatabase();
        }
        return sharedInstance;
    }
}

Database.getInstance = () => {
    if (!sharedInstance) {
        sharedInstance = createDatabase();
    }
    return sharedInstance;
};

Database.resetInstance = () => {
    sharedInstance = null;
};

module.exports = Database;
