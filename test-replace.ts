const workspaceFoldersJson = JSON.stringify(['C:\\Users\\Bob$&\\Project<script>alert(1)</script>']);
let html = "const workspaceFolders = ${WORKSPACE_FOLDERS};\nconst slashCommandScopes = ${SLASH_COMMAND_SCOPES};";
const slashCommandScopesJson = JSON.stringify({"/c": {scope: "commands"}, "foo$&<script>": {scope: "test"}});

const sanitizedWorkspaceFolders = workspaceFoldersJson.replace(/</g, '\\u003c');
const sanitizedSlashCommandScopes = slashCommandScopesJson.replace(/</g, '\\u003c');

html = html.replace(/\${SLASH_COMMAND_SCOPES}/g, () => sanitizedSlashCommandScopes);
html = html.replace(/\${WORKSPACE_FOLDERS}/g, () => sanitizedWorkspaceFolders);
console.log(html);
