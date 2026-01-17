using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.ToolWindows;
using Microsoft.VisualStudio.RpcContracts.RemoteUI;

namespace DeepLensVisualStudio.ToolWindows
{
    /// <summary>
    /// Tool window for DeepLens Search functionality.
    /// </summary>
    [VisualStudioContribution]
    public class SearchToolWindow : ToolWindow
    {
        /// <summary>
        /// Gets the configuration for this tool window.
        /// </summary>
        public override ToolWindowConfiguration ToolWindowConfiguration => new ToolWindowConfiguration
        {
            Placement = ToolWindowPlacement.Floating,
            AllowAutoCreation = true,
        };

        /// <summary>
        /// Gets the content of the tool window.
        /// </summary>
        public override Task<IRemoteUserControl> GetContentAsync(CancellationToken cancellationToken)
        {
            // Note: VisualStudio.Extensibility uses RemoteUI which requires a different approach
            // For VSSDK compatibility mode, we use a traditional WPF control approach
            // This requires hosting via AsyncPackage pattern
            return Task.FromResult<IRemoteUserControl>(null!);
        }
    }
}
