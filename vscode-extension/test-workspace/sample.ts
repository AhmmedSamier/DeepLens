class UserService {
    public defaultRole: UserRole = UserRole.User;
    private users: string[] = [];

    addUser(name: string) {
        this.users.push(name);
    }
}

interface UserProfile {
    id: string;
    username: string;
}

enum UserRole {
    Admin,
    User
}
