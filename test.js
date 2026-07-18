const str = 'foo ${WORKSPACE_FOLDERS} bar';
const workspaceFolders = ['/home/user/$&/test</script><script>alert(1)</script>'];
const workspaceFoldersJson = JSON.stringify(workspaceFolders).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
console.log(str.replace(/\${WORKSPACE_FOLDERS}/g, () => workspaceFoldersJson));
