# API Contracts: File Icons in Search Results

**Date**: 2026-02-12  
**Feature**: File Icons in Search Results  
**Branch**: 001-file-icons-search  

## Overview

These contracts define the interface for integrating file icons into the existing search functionality. Since this is a frontend enhancement, the contracts focus on component interfaces and data structures rather than traditional REST/GraphQL APIs.

## Component Contracts

### 1. FileIcon Component

**Purpose**: Display a VSCode-style file icon with proper styling and fallback

**Props Interface**:
```typescript
interface FileIconProps {
  iconName: string;          // VSCode icon identifier
  size?: 'small' | 'medium' | 'large'; // Icon size
  className?: string;        // Additional CSS classes
  fallback?: string;        // Fallback text when icon fails to load
  onLoad?: () => void;       // Callback when icon loads successfully
  onError?: () => void;      // Callback when icon fails to load
}
```

**Events**:
- `onLoad`: Emitted when icon loads successfully
- `onError`: Emitted when icon fails to load

**Usage Example**:
```typescript
<FileIcon 
  iconName="typescript" 
  size="medium"
  fallback=".ts"
  onLoad={() => console.log('Icon loaded')}
  onError={() => console.log('Icon failed to load')}
/>
```

### 2. SearchResultItem Component

**Purpose**: Display a search result with file icon and metadata

**Props Interface**:
```typescript
interface SearchResultItemProps {
  file: File;                // File metadata object
  icon: FileIcon;           // Icon configuration
  score: number;           // Search relevance score (0-1)
  isHighlighted?: boolean;  // Whether item is currently selected
  onClick?: () => void;     // Click handler
  onMouseEnter?: () => void; // Mouse enter handler
  className?: string;       // Additional CSS classes
}
```

**Events**:
- `onClick`: Emitted when result item is clicked
- `onMouseEnter`: Emitted when mouse enters the item

**Usage Example**:
```typescript
<SearchResultItem 
  file={fileData}
  icon={iconConfig}
  score={0.95}
  isHighlighted={isSelected}
  onClick={() => handleFileSelect(fileData)}
/>
```

### 3. SearchResults Component

**Purpose**: Container for search results with icon support

**Props Interface**:
```typescript
interface SearchResultsProps {
  results: SearchResult[];  // Array of search results
  loading?: boolean;         // Whether results are loading
  onIconLoad?: (iconName: string) => void; // Icon load callback
  onIconError?: (iconName: string) => void; // Icon error callback
}
```

**Events**:
- `onIconLoad`: Emitted when any icon loads
- `onIconError`: Emitted when any icon fails to load

**Usage Example**:
```typescript
<SearchResults 
  results={searchResults}
  loading={isSearching}
  onIconLoad={handleIconLoad}
  onIconError={handleIconError}
/>
```

## Service Contracts

### 1. FileTypeDetector Service

**Purpose**: Detect file type from file metadata

**Interface**:
```typescript
interface FileTypeDetector {
  detect(file: File): string;      // Detect file type by extension/pattern
  getIconName(file: File): string; // Get VSCode icon name for file
  isSupported(extension: string): boolean; // Check if extension is supported
}
```

**Methods**:
- `detect(file: File): string` - Returns the detected file type
- `getIconName(file: File): string` - Returns the VSCode icon name
- `isSupported(extension: string): boolean` - Checks if extension is supported

### 2. IconLoader Service

**Purpose**: Load and cache VSCode icons with performance optimizations

**Interface**:
```typescript
interface IconLoader {
  loadIcon(iconName: string): Promise<FileIcon>; // Load single icon
  loadIcons(iconNames: string[]): Promise<Map<string, FileIcon>>; // Load multiple icons
  preloadCommonIcons(): Promise<void>; // Preload commonly used icons
  getFromCache(iconName: string): FileIcon | null; // Get from cache
  clearCache(): void; // Clear icon cache
}
```

**Methods**:
- `loadIcon(iconName: string): Promise<FileIcon>` - Loads a single icon
- `loadIcons(iconNames: string[]): Promise<Map<string, FileIcon>>` - Loads multiple icons
- `preloadCommonIcons(): Promise<void>` - Preloads commonly used icons
- `getFromCache(iconName: string): FileIcon | null` - Retrieves icon from cache
- `clearCache(): void` - Clears the icon cache

### 3. SearchIconService

**Purpose**: Integrates icon functionality with existing search service

**Interface**:
```typescript
interface SearchIconService {
  enhanceResults(results: SearchResult[]): Promise<EnhancedSearchResult[]>;
  preloadSearchIcons(results: SearchResult[]): Promise<void>;
  clearIconCache(): void;
}
```

**Methods**:
- `enhanceResults(results: SearchResult[]): Promise<EnhancedSearchResult[]>` - Adds icons to search results
- `preloadSearchIcons(results: SearchResult[]): Promise<void>` - Preloads icons for search results
- `clearIconCache(): void` - Clears icon cache

## Data Contracts

### File Type

```typescript
interface File {
  id: string;
  name: string;
  extension: string;
  path: string;
  type: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
}
```

### FileIcon

```typescript
interface FileIcon {
  name: string;
  character: string;
  cssClass: string;
  fileTypes: string[];
  extensions: string[];
}
```

### SearchResult

```typescript
interface SearchResult {
  file: File;
  icon: FileIcon;
  score: number;
  highlight: string;
  isHighlighted: boolean;
}
```

### EnhancedSearchResult (extends SearchResult)

```typescript
interface EnhancedSearchResult extends SearchResult {
  iconLoaded: boolean;
  iconError?: boolean;
  fallbackText?: string;
}
```

## Event Contracts

### Icon Loading Events

```typescript
interface IconEvents {
  'icon:loaded': {
    iconName: string;
    timestamp: Date;
  };
  'icon:error': {
    iconName: string;
    error: Error;
    timestamp: Date;
  };
  'icon:cache-hit': {
    iconName: string;
    timestamp: Date;
  };
}
```

### Search Integration Events

```typescript
interface SearchEvents {
  'search:icon-enhancement-complete': {
    resultCount: number;
    loadTime: number;
    errorCount: number;
  };
  'search:icon-preload-complete': {
    iconCount: number;
    preloadTime: number;
  };
}
```

## Error Handling Contracts

### Icon Loading Errors

```typescript
enum IconErrorType {
  NOT_FOUND = 'ICON_NOT_FOUND',
  LOAD_FAILED = 'ICON_LOAD_FAILED',
  NETWORK_ERROR = 'ICON_NETWORK_ERROR',
  TIMEOUT = 'ICON_TIMEOUT'
}

interface IconError {
  type: IconErrorType;
  iconName: string;
  message: string;
  timestamp: Date;
}
```

### Fallback Strategy

When icon loading fails:
1. Log the error for debugging
2. Display fallback text (file extension)
3. Optionally show a generic file icon
4. Continue normal search functionality

## Performance Contracts

### Loading Time Constraints

- Icon loading must not exceed 100ms per icon
- Batch icon loading must complete within 200ms for up to 10 icons
- Icon cache hit must be immediate (< 5ms)

### Memory Usage

- Icon cache must not exceed 50MB in total
- Individual icons must be cleaned up when not in use
- Cache eviction policy: LRU (Least Recently Used)

### Network Requests

- Icons should be loaded from the same origin as the application
- Implement request deduplication to avoid duplicate loads
- Support offline fallback for previously loaded icons

## Integration Points

### Existing Search Service Integration

The icon service integrates with the existing search service by:

1. **Enhancing Results**: Adding icon metadata to existing search results
2. **Preloading**: Loading icons before results are displayed
3. **Caching**: Managing icon cache for performance
4. **Fallbacks**: Handling icon loading errors gracefully

### Component Integration

Components integrate through:

1. **Props**: Receiving file metadata and icon configuration
2. **Events**: Emitting loading and error events
3. **Context**: Sharing icon service instance
4. **Styling**: Using CSS variables for VSCode consistency

These contracts ensure consistent implementation across the codebase while maintaining the flexibility needed for different usage scenarios.