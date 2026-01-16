using System;

namespace DeepLens.VisualStudio.Services
{
    public static class FuzzyMatcher
    {
        public static bool IsMatch(string pattern, string text)
        {
            if (string.IsNullOrEmpty(pattern)) return true;
            if (string.IsNullOrEmpty(text)) return false;

            // 1. Exact match (case insensitive)
            if (text.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0)
                return true;

            // 2. CamelHumps
            // If pattern consists of uppercase letters, try matching uppercase letters in text
            if (IsCamelHumpsMatch(pattern, text))
                return true;

            // 3. Subsequence match (Fuzzy)
            // "fbar" matches "foobar"
            return IsSubsequenceMatch(pattern, text);
        }

        private static bool IsCamelHumpsMatch(string pattern, string text)
        {
             // Check if pattern is all uppercase
            foreach (char c in pattern)
            {
                if (!char.IsUpper(c)) return false;
            }

            int pIdx = 0;
            for (int tIdx = 0; tIdx < text.Length && pIdx < pattern.Length; tIdx++)
            {
                char tChar = text[tIdx];
                if (char.IsUpper(tChar))
                {
                    if (tChar == pattern[pIdx])
                    {
                        pIdx++;
                    }
                }
            }

            return pIdx == pattern.Length;
        }

        private static bool IsSubsequenceMatch(string pattern, string text)
        {
            int pIdx = 0;
            int tIdx = 0;
            while (pIdx < pattern.Length && tIdx < text.Length)
            {
                if (char.ToLowerInvariant(pattern[pIdx]) == char.ToLowerInvariant(text[tIdx]))
                {
                    pIdx++;
                }
                tIdx++;
            }
            return pIdx == pattern.Length;
        }
    }
}
