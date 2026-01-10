using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.Extensibility;
using System.Threading;
using System.Threading.Tasks;

namespace visual_studio_extension
{
    /// <summary>
    /// Extension entrypoint for the VisualStudio.Extensibility extension.
    /// </summary>
    [VisualStudioContribution]
    internal class ExtensionEntrypoint : Extension
    {
        public LspService? LspService { get; private set; }

        /// <inheritdoc/>
        public override ExtensionConfiguration ExtensionConfiguration => new()
        {
            Metadata = new(
                    id: "visual_studio_extension.7627e305-9085-4b1a-b26c-a855ac55bd6e",
                    version: this.ExtensionAssemblyVersion,
                    publisherName: "Publisher name",
                    displayName: "DeepLens Search",
                    description: "Fast semantic search for your codebase"),
        };

        /// <inheritdoc />
        protected override void InitializeServices(IServiceCollection serviceCollection)
        {
            base.InitializeServices(serviceCollection);
        }

        protected override async Task OnInitializeAsync(CancellationToken cancellationToken)
        {
            await base.OnInitializeAsync(cancellationToken);

            LspService = new LspService(this);
            // We assume the workspace root is available or we initialize lazily
        }

        protected override void Dispose(bool disposing)
        {
            LspService?.Dispose();
            base.Dispose(disposing);
        }

        // Helper to ensure initialization
        public async Task EnsureLspInitializedAsync()
        {
            if (LspService == null) return;
            // logic to check if internal state is initialized or trigger it
            // We'll leave it to the Command to provide the path for now,
            // but for restore scenarios we might need to find a way to get the path here.
        }
    }
}
