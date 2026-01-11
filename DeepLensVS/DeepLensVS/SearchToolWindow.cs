namespace DeepLensVS
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.ToolWindows;
    using Microsoft.VisualStudio.RpcContracts.RemoteUI;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    /// A tool window for the DeepLens search.
    /// </summary>
    [VisualStudioContribution]
    public class SearchToolWindow : ToolWindow
    {
        private SearchViewModel? viewModel;
        private readonly VisualStudioExtensibility extensibility;

        /// <summary>
        /// Initializes a new instance of the <see cref="SearchToolWindow" /> class.
        /// </summary>
        /// <param name="extensibility">Extensibility object of the extension.</param>
        public SearchToolWindow(VisualStudioExtensibility extensibility)
            : base(extensibility)
        {
            this.extensibility = extensibility;
            this.Title = "DeepLens Search";
        }

        /// <inheritdoc />
        public override ToolWindowConfiguration ToolWindowConfiguration => new()
        {
            // The tool window will be floating by default or can be docked.
            Placement = ToolWindowPlacement.Floating,
        };

        /// <inheritdoc />
        public override Task<IRemoteUserControl> GetContentAsync(CancellationToken cancellationToken)
        {
            this.viewModel ??= new SearchViewModel(this.extensibility);
            return Task.FromResult<IRemoteUserControl>(new SearchToolWindowContent(this.viewModel));
        }
        
        /// <inheritdoc />
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                this.viewModel?.Dispose();
            }

            base.Dispose(disposing);
        }
    }
}
