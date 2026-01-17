using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.Commands;

namespace DeepLensVisualStudio.Commands
{
    /// <summary>
    /// A hidden command that activates when VS starts to trigger extension initialization.
    /// This command uses ActivationConstraint to load the extension at startup.
    /// </summary>
    [VisualStudioContribution]
    internal class StartupActivationCommand : Command
    {
        /// <inheritdoc />
        public override CommandConfiguration CommandConfiguration => new("%DeepLensVisualStudio.StartupActivationCommand.DisplayName%")
        {
            // Not placed in any menu - this is just to trigger extension activation
            Placements = Array.Empty<CommandPlacement>(),
            
            // This makes the extension activate when VS starts (IDE is available)
            VisibleWhen = ActivationConstraint.ClientContext(ClientContextKey.Shell.ActiveSelectionFileName, ".*"),
        };

        /// <inheritdoc />
        public override Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            // This command never executes - it just triggers extension loading
            return Task.CompletedTask;
        }
    }
}
