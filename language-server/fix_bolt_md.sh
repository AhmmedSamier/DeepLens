tmpfile="$(mktemp)"
sed '/2024-03-24 - Fast Remaining Scopes Iteration Optimization/d; /\*\*Action:\*\* In multi-pass search or filtering/d' .jules/bolt.md > "$tmpfile" && mv "$tmpfile" .jules/bolt.md
