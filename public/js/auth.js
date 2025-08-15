// Authentication JavaScript
class AuthManager {
    constructor() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Login form
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Profile link
        const profileLink = document.getElementById('profile-link');
        if (profileLink) {
            profileLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showProfileModal();
            });
        }

        // Tokens link
        const tokensLink = document.getElementById('tokens-link');
        if (tokensLink) {
            tokensLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showTokensModal();
            });
        }
    }

    async handleLogin() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const errorDiv = document.getElementById('login-error');
        const loginBtn = document.getElementById('login-btn-text');
        const spinner = document.getElementById('login-spinner');

        // Show loading state
        loginBtn.textContent = 'Logging in...';
        spinner.classList.remove('hidden');
        errorDiv.classList.add('hidden');

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            // Store token and user data
            localStorage.setItem('authToken', data.token);
            
            // Load user data and hide login modal
            await app.loadUserData();
            app.hideLoginModal();
            // Route based on current URL (hash) or default
            app.handleRouteChange();
            
            // Clear form
            document.getElementById('login-form').reset();
            
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        } finally {
            // Reset button state
            loginBtn.textContent = 'Login';
            spinner.classList.add('hidden');
        }
    }

    showProfileModal() {
        // Create profile modal dynamically
        const modal = document.createElement('div');
        modal.id = 'profile-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-8 max-w-md w-full mx-4">
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">Profile</h2>
                    <button onclick="this.closest('#profile-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                </div>
                <form id="profile-form">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Username</label>
                        <input type="text" value="${app.currentUser.username}" class="input" disabled>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Email</label>
                        <input type="email" value="${app.currentUser.email || ''}" class="input" disabled>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Role</label>
                        <input type="text" value="${app.currentUser.role}" class="input" disabled>
                    </div>
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Member Since</label>
                        <input type="text" value="${new Date(app.currentUser.created_at).toLocaleDateString()}" class="input" disabled>
                    </div>
                    <button type="button" onclick="auth.showChangePasswordModal()" class="btn btn-primary w-full">
                        Change Password
                    </button>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    showChangePasswordModal() {
        // Close profile modal
        document.getElementById('profile-modal')?.remove();
        
        const modal = document.createElement('div');
        modal.id = 'change-password-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-8 max-w-md w-full mx-4">
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">Change Password</h2>
                    <button onclick="this.closest('#change-password-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                </div>
                <form id="change-password-form">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Current Password</label>
                        <input type="password" id="current-password" class="input" required>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">New Password</label>
                        <input type="password" id="new-password" class="input" required>
                    </div>
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Confirm New Password</label>
                        <input type="password" id="confirm-password" class="input" required>
                    </div>
                    <div id="password-error" class="text-red-600 text-sm mb-4 hidden"></div>
                    <button type="submit" class="btn btn-primary w-full">
                        Update Password
                    </button>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Setup form handler
        document.getElementById('change-password-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleChangePassword();
        });
    }

    async handleChangePassword() {
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const errorDiv = document.getElementById('password-error');

        errorDiv.classList.add('hidden');

        if (newPassword !== confirmPassword) {
            errorDiv.textContent = 'New passwords do not match';
            errorDiv.classList.remove('hidden');
            return;
        }

        if (newPassword.length < 6) {
            errorDiv.textContent = 'Password must be at least 6 characters long';
            errorDiv.classList.remove('hidden');
            return;
        }

        try {
            await app.apiCall('/api/auth/change-password', {
                method: 'PUT',
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            });

            app.showSuccess('Password updated successfully');
            document.getElementById('change-password-modal').remove();
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        }
    }

    async showTokensModal() {
        try {
            const tokens = await app.apiCall('/api/auth/tokens');
            
            const modal = document.createElement('div');
            modal.id = 'tokens-modal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            
            modal.innerHTML = `
                <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-8 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                    <div class="flex items-center justify-between mb-6">
                        <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">API Tokens</h2>
                        <button onclick="this.closest('#tokens-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                    </div>
                    
                    <div class="mb-6">
                        <button onclick="auth.showCreateTokenModal()" class="btn btn-primary">Create New Token</button>
                    </div>
                    
                    <div class="space-y-3">
                        ${tokens.length === 0 ? 
                            '<p class="text-gray-500 dark:text-dark-text-secondary">No API tokens created yet.</p>' :
                            tokens.map(token => `
                                <div class="commit-card flex items-center justify-between">
                                    <div>
                                        <div class="font-medium text-gray-900 dark:text-dark-text">${token.name}</div>
                                        <div class="text-sm text-gray-500 dark:text-dark-text-secondary">
                                            Created: ${new Date(token.created_at).toLocaleDateString()}
                                            ${token.expires_at ? `• Expires: ${new Date(token.expires_at).toLocaleDateString()}` : '• Never expires'}
                                        </div>
                                    </div>
                                    <div class="flex items-center space-x-2">
                                        <span class="badge ${token.is_active ? 'badge-success' : 'badge-gray'}">
                                            ${token.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                        ${token.is_active ? `
                                            <button onclick="auth.revokeToken(${token.id})" class="btn btn-danger btn-sm">
                                                Revoke
                                            </button>
                                        ` : ''}
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
        } catch (error) {
            app.showError('Failed to load API tokens');
        }
    }

    showCreateTokenModal() {
        const modal = document.createElement('div');
        modal.id = 'create-token-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-8 max-w-md w-full mx-4">
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">Create API Token</h2>
                    <button onclick="this.closest('#create-token-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                </div>
                <form id="create-token-form">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Token Name</label>
                        <input type="text" id="token-name" class="input" placeholder="e.g., CI/CD Pipeline" required>
                    </div>
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Expiration (Optional)</label>
                        <input type="date" id="token-expires" class="input">
                    </div>
                    <div id="create-token-error" class="text-red-600 text-sm mb-4 hidden"></div>
                    <button type="submit" class="btn btn-primary w-full">
                        Create Token
                    </button>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('create-token-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCreateToken();
        });
    }

    async handleCreateToken() {
        const name = document.getElementById('token-name').value;
        const expiresAt = document.getElementById('token-expires').value || null;
        const errorDiv = document.getElementById('create-token-error');

        errorDiv.classList.add('hidden');

        try {
            const newToken = await app.apiCall('/api/auth/tokens', {
                method: 'POST',
                body: JSON.stringify({ name, expiresAt })
            });

            // Show the new token to user
            this.showNewTokenModal(newToken);
            document.getElementById('create-token-modal').remove();
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        }
    }

    showNewTokenModal(tokenData) {
        const modal = document.createElement('div');
        modal.id = 'new-token-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-8 max-w-md w-full mx-4">
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">New API Token</h2>
                    <button onclick="this.closest('#new-token-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                </div>
                <div class="mb-4">
                    <p class="text-gray-600 dark:text-dark-text-secondary mb-4">
                        Please copy your new API token. You won't be able to see it again!
                    </p>
                    <div class="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg">
                        <code class="font-mono text-sm break-all">${tokenData.token}</code>
                    </div>
                </div>
                <button onclick="auth.copyToClipboard('${tokenData.token}')" class="btn btn-primary w-full mb-2">
                    Copy Token
                </button>
                <button onclick="this.closest('#new-token-modal').remove()" class="btn btn-secondary w-full">
                    Close
                </button>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    async revokeToken(tokenId) {
        if (!confirm('Are you sure you want to revoke this token? This action cannot be undone.')) {
            return;
        }

        try {
            await app.apiCall(`/api/auth/tokens/${tokenId}`, {
                method: 'DELETE'
            });

            app.showSuccess('Token revoked successfully');
            
            // Refresh tokens modal
            document.getElementById('tokens-modal').remove();
            this.showTokensModal();
        } catch (error) {
            app.showError('Failed to revoke token');
        }
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            app.showSuccess('Token copied to clipboard');
        }).catch(() => {
            app.showError('Failed to copy token');
        });
    }
}

// Initialize auth manager
const auth = new AuthManager();
