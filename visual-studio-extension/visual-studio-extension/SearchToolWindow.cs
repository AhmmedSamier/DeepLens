using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.UI;

namespace visual_studio_extension
{
    [VisualStudioContribution]
    public class SearchToolWindow : ToolWindow
    {
        private readonly ExtensionEntrypoint _extension;

        public SearchToolWindow(ExtensionEntrypoint extension)
        {
            _extension = extension;
            this.Title = "DeepLens Search";
        }

        public override ToolWindowConfiguration ToolWindowConfiguration => new()
        {
            Placement = ToolWindowPlacement.Floating,
            DockDirection = Dock.Right,
            AllowAutoCreation = true,
        };

        public override Task<IRemoteUserControl> GetContentAsync(CancellationToken cancellationToken)
        {
            return Task.FromResult<IRemoteUserControl>(new SearchToolWindowContent(_extension));
        }
    }
}
