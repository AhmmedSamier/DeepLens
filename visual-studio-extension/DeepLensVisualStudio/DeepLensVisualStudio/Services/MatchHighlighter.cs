using System;
using System.Collections.Generic;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.TextManager.Interop;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace DeepLensVisualStudio.Services
{
    public class MatchHighlighter : IVsTextMarkerClient
    {
        private readonly List<IVsTextMarker> _activeMarkers = new List<IVsTextMarker>();
        private static MatchHighlighter? _instance;
        public static MatchHighlighter Instance => _instance ??= new MatchHighlighter();

        public void HighlightMatch(IVsTextView view, int line, int column, int length)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            
            if (view == null) return;

            view.GetBuffer(out IVsTextLines buffer);
            if (buffer == null) return;

            IVsTextLineMarker[] markers = new IVsTextLineMarker[1];
            
            // We want to highlight the range.
            int startLine = line;
            int startIndex = column;
            int endLine = line;
            int endIndex = column + length;

            // Use MARKERTYPE.MARKER_INVISIBLE so we can draw it ourselves via client
            int markerType = (int)MARKERTYPE.MARKER_INVISIBLE;
            
            int hr = buffer.CreateLineMarker(
                markerType,
                startLine, startIndex,
                endLine, endIndex,
                this, // Client
                markers
            );

            if (ErrorHandler.Succeeded(hr) && markers[0] != null)
            {
                var marker = markers[0];
                _activeMarkers.Add(marker);
                
                // Set behavior to draw background
                // MV_COLOR_ALWAYS ensures GetMarkerColors is called
                // MV_COLOR_ALWAYS = 0x20, MV_TIP_FOR_BODY = 0x10
                uint dwFlags = 0x20 | 0x10;
                marker.SetBehavior(dwFlags);
            }
        }

        public void ClearHighlights(IVsTextView view)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            
            foreach (var marker in _activeMarkers)
            {
                try
                {
                    marker.Invalidate();
                    // We don't need to explicitly unadvise if we invalidate/destroy
                }
                catch { }
            }
            _activeMarkers.Clear();
        }

        #region IVsTextMarkerClient Implementation
        public void MarkerInvalidated()
        {
        }

        public int GetMarkerColors(IVsTextMarker pMarker, int iItem, out uint pclrForeground, out uint pclrBackground)
        {
            // Return colors (BGR format for COLORREF)
            // Yellow: R=FF, G=FF, B=00 -> 0x0000FFFF
            // Orange: R=FF, G=A5, B=00 -> 0x0000A5FF
            
            // To be truly theme aware we should query the service, but for now we use a high-visibility color
            // that works in both dark and light themes (Yellow is usually okay-ish, maybe a bit bright for dark theme)
            // Let's use a Gold color: 255, 215, 0 -> 0x0000D7FF
            
            pclrForeground = 0; // Use default foreground
            pclrBackground = 0x0000D7FF; 
            
            return VSConstants.S_OK;
        }

        public int GetMarkerCommandInfo(IVsTextMarker pMarker, int iItem, string[] pbstrText, uint[] pcmdf)
        {
            return VSConstants.E_NOTIMPL;
        }

        public int ExecMarkerCommand(IVsTextMarker pMarker, int iItem)
        {
            return VSConstants.E_NOTIMPL;
        }

        public int GetTipText(IVsTextMarker pMarker, string[] pbstrText)
        {
            return VSConstants.E_NOTIMPL;
        }

        public void OnBufferSave(string pszFileName)
        {
        }

        public void OnBeforeBufferClose()
        {
        }

        public void OnAfterSpanReload()
        {
        }

        public int OnAfterMarkerChange(IVsTextMarker pMarker)
        {
            return VSConstants.S_OK;
        }
        #endregion
    }
}
