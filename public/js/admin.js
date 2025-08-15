// Admin functionality JavaScript
class AdminManager {
    constructor() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Add user button
        const addUserBtn = document.getElementById('add-user-btn');
        if (addUserBtn) {
            addUserBtn.addEventListener('click', () => {
                this.showAddUserModal();
            });
        }

        // Add repository button  
        const addRepoBtn = document.getElementById('add-repo-btn');
        if (addRepoBtn) {
            addRepoBtn.addEventListener('click', () => {
                this.showAddRepositoryModal();
            });
        }
    }

    async loadAdminPage() {
        try {
            // Load admin stats
            await this.loadAdminStats();
            
            // Load users list
            await this.loadUsersList();
        } catch (error) {
            console.error('Error loading admin page:', error);
            app.showError('Failed to load admin data');
        }
    }

    async loadAdminStats() {
        try {
            const stats = await app.apiCall('/api/admin/stats');
            
            const adminStatsContainer = document.getElementById('admin-stats');
            adminStatsContainer.innerHTML = `
                <div class="stat-card">
                    <div class="text-2xl font-bold">${stats.totalUsers}</div>
                    <div class="text-sm opacity-90">Total Users</div>
                </div>
                <div class="stat-card">
                    <div class="text-2xl font-bold">${stats.adminUsers}</div>
                    <div class="text-sm opacity-90">Admin Users</div>
                </div>
                <div class="stat-card">
                    <div class="text-2xl font-bold">${stats.totalRepositories}</div>
                    <div class="text-sm opacity-90">Repositories</div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading admin stats:', error);
        }
    }

    async loadUsersList() {
        try {
            const users = await app.apiCall('/api/admin/users');
            
            const usersContainer = document.getElementById('users-list');
            usersContainer.innerHTML = `
                <div class="overflow-x-auto">
                    <table class="min-w-full">
                        <thead class="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">User</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Role</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white dark:bg-dark-bg-secondary divide-y divide-gray-200 dark:divide-gray-700">
                            ${users.map(user => `
                                <tr>
                                    <td class="px-6 py-4 whitespace-nowrap">
                                        <div>
                                            <div class="text-sm font-medium text-gray-900 dark:text-dark-text">${user.username}</div>
                                            <div class="text-sm text-gray-500 dark:text-dark-text-secondary">${user.email || 'No email'}</div>
                                        </div>
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap">
                                        <span class="badge ${user.role === 'admin' ? 'badge-primary' : 'badge-gray'}">
                                            ${user.role}
                                        </span>
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-dark-text-secondary">
                                        ${new Date(user.created_at).toLocaleDateString()}
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                        <button onclick="admin.editUser(${user.id})" class="btn btn-secondary btn-sm">
                                            Edit
                                        </button>
                                        ${user.id !== app.currentUser.id ? `
                                            <button onclick="admin.deleteUser(${user.id}, '${user.username}')" class="btn btn-danger btn-sm">
                                                Delete
                                            </button>
                                        ` : ''}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        } catch (error) {
            console.error('Error loading users list:', error);
        }
    }

    showAddUserModal() {
        const modal = document.createElement('div');
        modal.id = 'add-user-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-8 max-w-md w-full mx-4">
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">Add New User</h2>
                    <button onclick="this.closest('#add-user-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                </div>
                <form id="add-user-form">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Username</label>
                        <input type="text" id="new-username" class="input" required>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Email (Optional)</label>
                        <input type="email" id="new-email" class="input">
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Password</label>
                        <input type="password" id="new-password" class="input" required>
                    </div>
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Role</label>
                        <select id="new-role" class="select">
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <div id="add-user-error" class="text-red-600 text-sm mb-4 hidden"></div>
                    <button type="submit" class="btn btn-primary w-full">
                        Add User
                    </button>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('add-user-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddUser();
        });
    }

    async handleAddUser() {
        const username = document.getElementById('new-username').value;
        const email = document.getElementById('new-email').value;
        const password = document.getElementById('new-password').value;
        const role = document.getElementById('new-role').value;
        const errorDiv = document.getElementById('add-user-error');

        errorDiv.classList.add('hidden');

        if (password.length < 6) {
            errorDiv.textContent = 'Password must be at least 6 characters long';
            errorDiv.classList.remove('hidden');
            return;
        }

        try {
            await app.apiCall('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify({ username, email, password, role })
            });

            app.showSuccess('User added successfully');
            document.getElementById('add-user-modal').remove();
            await this.loadUsersList();
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        }
    }

    async editUser(userId) {
        try {
            // Get current user data (we could add an endpoint for this, but for now use the users list)
            const users = await app.apiCall('/api/admin/users');
            const user = users.find(u => u.id === userId);
            
            if (!user) {
                app.showError('User not found');
                return;
            }

            const modal = document.createElement('div');
            modal.id = 'edit-user-modal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            
            modal.innerHTML = `
                <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-8 max-w-md w-full mx-4">
                    <div class="flex items-center justify-between mb-6">
                        <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">Edit User</h2>
                        <button onclick="this.closest('#edit-user-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                    </div>
                    <form id="edit-user-form">
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Username</label>
                            <input type="text" id="edit-username" class="input" value="${user.username}" required>
                        </div>
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Email</label>
                            <input type="email" id="edit-email" class="input" value="${user.email || ''}">
                        </div>
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">New Password (leave blank to keep current)</label>
                            <input type="password" id="edit-password" class="input">
                        </div>
                        <div class="mb-6">
                            <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Role</label>
                            <select id="edit-role" class="select">
                                <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                        </div>
                        <div id="edit-user-error" class="text-red-600 text-sm mb-4 hidden"></div>
                        <button type="submit" class="btn btn-primary w-full">
                            Update User
                        </button>
                    </form>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            document.getElementById('edit-user-form').addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleEditUser(userId);
            });
        } catch (error) {
            app.showError('Failed to load user data');
        }
    }

    async handleEditUser(userId) {
        const username = document.getElementById('edit-username').value;
        const email = document.getElementById('edit-email').value;
        const password = document.getElementById('edit-password').value;
        const role = document.getElementById('edit-role').value;
        const errorDiv = document.getElementById('edit-user-error');

        errorDiv.classList.add('hidden');

        const updateData = { username, email, role };
        if (password) {
            if (password.length < 6) {
                errorDiv.textContent = 'Password must be at least 6 characters long';
                errorDiv.classList.remove('hidden');
                return;
            }
            updateData.password = password;
        }

        try {
            await app.apiCall(`/api/admin/users/${userId}`, {
                method: 'PUT',
                body: JSON.stringify(updateData)
            });

            app.showSuccess('User updated successfully');
            document.getElementById('edit-user-modal').remove();
            await this.loadUsersList();
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        }
    }

    async deleteUser(userId, username) {
        if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
            return;
        }

        try {
            await app.apiCall(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });

            app.showSuccess('User deleted successfully');
            await this.loadUsersList();
        } catch (error) {
            app.showError('Failed to delete user');
        }
    }

    showAddRepositoryModal() {
        const modal = document.createElement('div');
        modal.id = 'add-repo-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-8 max-w-md w-full mx-4">
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">Add Repository</h2>
                    <button onclick="this.closest('#add-repo-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                </div>
                <form id="add-repo-form">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Repository Name</label>
                        <input type="text" id="repo-name" class="input" required>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Local Path</label>
                        <input type="text" id="repo-path" class="input" placeholder="C:/path/to/git/repository" required>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Remote URL (Optional)</label>
                        <input type="text" id="repo-url" class="input" placeholder="https://github.com/user/repo.git">
                    </div>
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Description (Optional)</label>
                        <textarea id="repo-description" class="input" rows="3"></textarea>
                    </div>
                    <div id="add-repo-error" class="text-red-600 text-sm mb-4 hidden"></div>
                    <button type="submit" class="btn btn-primary w-full">
                        Add Repository
                    </button>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('add-repo-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddRepository();
        });
    }

    async handleAddRepository() {
        const name = document.getElementById('repo-name').value;
        const path = document.getElementById('repo-path').value;
        const url = document.getElementById('repo-url').value;
        const description = document.getElementById('repo-description').value;
        const errorDiv = document.getElementById('add-repo-error');

        errorDiv.classList.add('hidden');

        try {
            await app.apiCall('/api/admin/repositories', {
                method: 'POST',
                body: JSON.stringify({ name, path, url, description })
            });

            app.showSuccess('Repository added successfully');
            document.getElementById('add-repo-modal').remove();
            
            // Refresh repositories if we're on that page
            if (app.currentPage === 'repositories') {
                await app.loadRepositoriesPage();
            }
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        }
    }
}

// Initialize admin manager
const admin = new AdminManager();
