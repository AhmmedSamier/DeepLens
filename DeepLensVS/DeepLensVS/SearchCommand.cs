namespace DeepLensVS
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    /// Command to open the DeepLens search tool window.
    /// </summary>
    [VisualStudioContribution]
    public class SearchCommand : Command
    {
        private readonly VisualStudioExtensibility extensibility;

        /// <summary>
        /// Initializes a new instance of the <see cref="SearchCommand" /> class.
        /// </summary>
        /// <param name="extensibility">Extensibility object of the extension.</param>
        public SearchCommand(VisualStudioExtensibility extensibility)
        {
            this.extensibility = extensibility;
        }

        /// <inheritdoc />
        public override CommandConfiguration CommandConfiguration => new("%DeepLensVS.SearchCommand.DisplayName%")
        {
            Placements = new[] { CommandPlacement.KnownPlacements.ExtensionsMenu },
            Icon = new(ImageMoniker.KnownValues.Search, IconSettings.IconAndText),
            Shortcuts = new[]
            {
                new CommandShortcutConfiguration(ModifierKey.ControlShift, Key.D),
            },
        };

        /// <inheritdoc />
        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            await this.extensibility.Shell().ShowToolWindowAsync<SearchToolWindow>(activate: true, cancellationToken);
        }
    }
}
