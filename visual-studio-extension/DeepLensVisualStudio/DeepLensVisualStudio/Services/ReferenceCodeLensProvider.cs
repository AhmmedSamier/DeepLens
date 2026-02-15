using System;
using System.ComponentModel.Composition;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Language.CodeLens;
using Microsoft.VisualStudio.Utilities;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.Language.CodeLens.Remoting;

namespace DeepLensVisualStudio.Services
{
    [Export(typeof(IAsyncCodeLensDataPointProvider))]
    [Name("DeepLensReferences")]
    [ContentType("CSharp")]
    [ContentType("TypeScript")]
    [ContentType("JavaScript")]
    [ContentType("Python")]
    [ContentType("Java")]
    [ContentType("Go")]
    [ContentType("C/C++")]
    [ContentType("Ruby")]
    [ContentType("PHP")]
    [ContentType("code")] // Fallback
    public class ReferenceCodeLensProvider : IAsyncCodeLensDataPointProvider
    {
        [Import]
        internal SVsServiceProvider ServiceProvider { get; set; } = null!;

        public Task<bool> CanCreateDataPointAsync(CodeLensDescriptor descriptor, CodeLensDescriptorContext context, CancellationToken token)
        {
            // Only show if we can map to a file and have a range
            return Task.FromResult(true); // Default to true if properties unknown
        }

        public Task<IAsyncCodeLensDataPoint> CreateDataPointAsync(CodeLensDescriptor descriptor, CodeLensDescriptorContext context, CancellationToken token)
        {
            var dataPoint = new ReferenceCodeLensDataPoint(descriptor, ServiceProvider);
            return Task.FromResult<IAsyncCodeLensDataPoint>(dataPoint);
        }
    }
}