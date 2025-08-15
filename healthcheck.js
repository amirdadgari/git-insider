const http = require('http');

const options = {
    hostname: 'localhost',
    port: process.env.PORT || 3201,
    path: '/api/auth/me',
    method: 'GET',
    timeout: 3000
};

const req = http.request(options, (res) => {
    if (res.statusCode === 401 || res.statusCode === 200) {
        // 401 is expected for unauthenticated health check, 200 if somehow authenticated
        console.log('Health check passed');
        process.exit(0);
    } else {
        console.log(`Health check failed with status: ${res.statusCode}`);
        process.exit(1);
    }
});

req.on('error', (err) => {
    console.log(`Health check failed: ${err.message}`);
    process.exit(1);
});

req.on('timeout', () => {
    console.log('Health check timeout');
    req.destroy();
    process.exit(1);
});

req.end();
