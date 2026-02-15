using System.Diagnostics;
using Microsoft.VisualStudio.Shell;

namespace DeepLensVisualStudio.Services
{
    /// <summary>
    /// Service that monitors git repository changes and triggers re-indexing on branch switches.
    /// </summary>
    public class GitService : IDisposable
    {
        private readonly Func<Task> _onRepoChange;
        private Timer? _debounceTimer;
        private string? _lastHead;
        private bool _disposed;

        public GitService(Func<Task> onRepoChange)
        {
            _onRepoChange = onRepoChange ?? throw new ArgumentNullException(nameof(onRepoChange));
        }

        public async Task SetupGitListenerAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            try
            {
                // Try to get Git Extensibility service via reflection (may not be available)
                var gitExtType = Type.GetType("Microsoft.VisualStudio.TeamFoundation.Git.Extensibility.IGitExt, Microsoft.VisualStudio.TeamFoundation.Git.Extensibility");
                if (gitExtType == null)
                {
                    Debug.WriteLine("DeepLens: Git extensibility API not available - skipping git change detection");
                    return;
                }

                var gitExt = ServiceProvider.GlobalProvider.GetService(gitExtType);
                if (gitExt == null)
                {
                    Debug.WriteLine("DeepLens: Git extension not found - skipping git change detection");
                    return;
                }

                // Use reflection to access Git API methods
                var getRepoInfoMethod = gitExtType.GetMethod("GetRepositoryInfo");
                if (getRepoInfoMethod != null)
                {
                    var repoInfo = getRepoInfoMethod.Invoke(gitExt, null);
                    if (repoInfo != null)
                    {
                        var stateChangedEvent = repoInfo.GetType().GetEvent("StateChanged");
                        if (stateChangedEvent != null)
                        {
                            var handler = Delegate.CreateDelegate(stateChangedEvent.EventHandlerType!, this, nameof(OnGitStateChanged));
                            stateChangedEvent.AddEventHandler(repoInfo, handler);
                        }

                        var currentBranchProp = repoInfo.GetType().GetProperty("CurrentBranch");
                        if (currentBranchProp != null)
                        {
                            _lastHead = currentBranchProp.GetValue(repoInfo) as string;
                            Debug.WriteLine($"DeepLens: Monitoring git repository. Initial HEAD: {_lastHead}");
                        }
                    }
                }

                Debug.WriteLine("DeepLens: Git listener setup complete");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error setting up git listener: {ex.Message}");
            }
        }

        private void OnGitStateChanged(object? sender, EventArgs e)
        {
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                try
                {
                    var gitExtType = Type.GetType("Microsoft.VisualStudio.TeamFoundation.Git.Extensibility.IGitExt, Microsoft.VisualStudio.TeamFoundation.Git.Extensibility");
                    if (gitExtType == null) return;

                    var gitExt = ServiceProvider.GlobalProvider.GetService(gitExtType);
                    if (gitExt == null) return;

                    var getRepoInfoMethod = gitExtType.GetMethod("GetRepositoryInfo");
                    if (getRepoInfoMethod == null) return;

                    var repoInfo = getRepoInfoMethod.Invoke(gitExt, null);
                    if (repoInfo == null) return;

                    var currentBranchProp = repoInfo.GetType().GetProperty("CurrentBranch");
                    if (currentBranchProp == null) return;

                    var currentHead = currentBranchProp.GetValue(repoInfo) as string;

                    if (currentHead != _lastHead)
                    {
                        Debug.WriteLine($"DeepLens: Git detected HEAD change: {_lastHead} -> {currentHead}");
                        _lastHead = currentHead;

                        // Debounce updates (3 second delay)
                        _debounceTimer?.Dispose();
                        _debounceTimer = new Timer(async _ =>
                        {
                            Debug.WriteLine($"[Git Event] Head moved from {_lastHead} to {currentHead}. Triggering full workspace refresh.");
                            await _onRepoChange();
                            Debug.WriteLine("[Git Event] Workspace refresh finished.");
                        }, null, TimeSpan.FromSeconds(3), Timeout.InfiniteTimeSpan);
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"DeepLens: Error in git state change handler: {ex.Message}");
                }
            });
        }

        public void Dispose()
        {
            if (_disposed) return;

            _debounceTimer?.Dispose();
            _debounceTimer = null;

            try
            {
                var gitExtType = Type.GetType("Microsoft.VisualStudio.TeamFoundation.Git.Extensibility.IGitExt, Microsoft.VisualStudio.TeamFoundation.Git.Extensibility");
                if (gitExtType != null)
                {
                    var gitExt = ServiceProvider.GlobalProvider.GetService(gitExtType);
                    if (gitExt != null)
                    {
                        var getRepoInfoMethod = gitExtType.GetMethod("GetRepositoryInfo");
                        if (getRepoInfoMethod != null)
                        {
                            var repoInfo = getRepoInfoMethod.Invoke(gitExt, null);
                            if (repoInfo != null)
                            {
                                var stateChangedEvent = repoInfo.GetType().GetEvent("StateChanged");
                                if (stateChangedEvent != null)
                                {
                                    var handler = Delegate.CreateDelegate(stateChangedEvent.EventHandlerType!, this, nameof(OnGitStateChanged));
                                    stateChangedEvent.RemoveEventHandler(repoInfo, handler);
                                }
                            }
                        }
                    }
                }
            }
            catch { }

            _disposed = true;
        }
    }
}
