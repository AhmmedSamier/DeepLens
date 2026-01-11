using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.Extensibility;

namespace DeepLensVS
{
    /// <summary>
    /// Extension entrypoint for the VisualStudio.Extensibility extension.
    /// </summary>
    [VisualStudioContribution]
    internal class ExtensionEntrypoint : Extension
    {
        /// <inheritdoc/>
        public override ExtensionConfiguration ExtensionConfiguration => new()
        {
            Metadata = new(
                    id: "DeepLensVS.f4aaf94c-e3b1-4e39-8b43-0738f9dac4d1",
                    version: this.ExtensionAssemblyVersion,
                    publisherName: "Ahmed Samir",
                    displayName: "DeepLens",
                    description: "Search everywhere in your workspace - types, symbols, files, and text with fuzzy matching."),
        };

        /// <inheritdoc />
        protected override void InitializeServices(IServiceCollection serviceCollection)
        {
            base.InitializeServices(serviceCollection);

            // You can configure dependency injection here by adding services to the serviceCollection.
        }
    }
}
