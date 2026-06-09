import { NotificationType, RequestType, RequestType0 } from 'vscode-languageserver';
import { SearchOptions, SearchResult } from './types';
import { DumpIndexResult, IndexStats } from './types';
import { SymbolInformation } from 'vscode-languageserver';

/**
 * LSP Protocol Types for DeepLens Custom Requests
 */

// ==================== Search Requests ====================

// ==================== Burst Search Request ====================

export type BurstSearchRequestParams = SearchOptions;

export type BurstSearchRequestResult = SearchResult[];

export const BurstSearchRequest = new RequestType<BurstSearchRequestParams, BurstSearchRequestResult, void>(
    'deeplens/burstSearch',
);

export interface StreamResultNotificationParams {
    requestId: number;
    result: SearchResult;
}

export const StreamResultNotification = new NotificationType<StreamResultNotificationParams>('deeplens/streamResult');

// ==================== Resolve Items Request ====================

export interface ResolveItemsRequestParams {
    itemIds: string[];
}

export type ResolveItemsRequestResult = SearchResult[];

export const ResolveItemsRequest = new RequestType<ResolveItemsRequestParams, ResolveItemsRequestResult, void>(
    'deeplens/resolveItems',
);

// ==================== Recent Items Request ====================

export interface GetRecentItemsRequestParams {
    count: number;
}

export type GetRecentItemsRequestResult = SearchResult[];

export const GetRecentItemsRequest = new RequestType<GetRecentItemsRequestParams, GetRecentItemsRequestResult, void>(
    'deeplens/getRecentItems',
);

// ==================== Activity Tracking ====================

export interface RecordActivityRequestParams {
    itemId: string;
}

export const RecordActivityRequest = new RequestType<RecordActivityRequestParams, void, void>(
    'deeplens/recordActivity',
);

export const ClearHistoryRequest = new RequestType0<void, void>('deeplens/clearHistory');

export interface RemoveHistoryItemRequestParams {
    itemId: string;
}

export const RemoveHistoryItemRequest = new RequestType<RemoveHistoryItemRequestParams, void, void>(
    'deeplens/removeHistoryItem',
);

// ==================== Index Management ====================

export interface RebuildIndexRequestParams {
    force?: boolean;
}

export const RebuildIndexRequest = new RequestType<RebuildIndexRequestParams, void, void>('deeplens/rebuildIndex');

export const ClearCacheRequest = new RequestType0<void, void>('deeplens/clearCache');

export const IndexStatsRequest = new RequestType0<IndexStats, void>('deeplens/indexStats');

// ==================== Active Files ====================

export interface SetActiveFilesRequestParams {
    files: string[];
}

export const SetActiveFilesRequest = new RequestType<SetActiveFilesRequestParams, void, void>(
    'deeplens/setActiveFiles',
);

// ==================== Index Dump ====================

export type DumpIndexRequestResult = DumpIndexResult;

export const DumpIndexRequest = new RequestType0<DumpIndexRequestResult, void>('deeplens/dumpIndex');

// ==================== Search Requests ====================

export const SearchRequest = new RequestType<SearchOptions, SearchResult[], void>('deeplens/search');

// ==================== Progress Notifications ====================

export interface ProgressNotificationParams {
    token: string;
    message: string;
    percentage: number;
}

export const ProgressNotification = new NotificationType<ProgressNotificationParams>('deeplens/progress');

// ==================== Ripgrep Unavailable ====================

export const RipgrepUnavailableNotification = new NotificationType<unknown>('deeplens/ripgrepUnavailable');

/**
 * Request TypeRegistry
 * Maps request method names to their param and result types
 */
export type RequestTypeMap = {
    'deeplens/search': {
        params: SearchOptions;
        result: SearchResult[];
    };
    'deeplens/burstSearch': {
        params: BurstSearchRequestParams;
        result: SearchResult[];
    };
    'deeplens/resolveItems': {
        params: ResolveItemsRequestParams;
        result: SearchResult[];
    };
    'deeplens/getRecentItems': {
        params: GetRecentItemsRequestParams;
        result: SearchResult[];
    };
    'deeplens/recordActivity': {
        params: RecordActivityRequestParams;
        result: void;
    };
    'deeplens/clearHistory': {
        params: void;
        result: void;
    };
    'deeplens/removeHistoryItem': {
        params: RemoveHistoryItemRequestParams;
        result: void;
    };
    'deeplens/rebuildIndex': {
        params: RebuildIndexRequestParams;
        result: void;
    };
    'deeplens/clearCache': {
        params: void;
        result: void;
    };
    'deeplens/indexStats': {
        params: void;
        result: IndexStats;
    };
    'deeplens/setActiveFiles': {
        params: SetActiveFilesRequestParams;
        result: void;
    };
    'deeplens/dumpIndex': {
        params: void;
        result: DumpIndexResult;
    };
    'workspace/symbol': {
        params: WorkspaceSymbolRequestParams;
        result: WorkspaceSymbolRequestResult;
    };
};

/**
 * Notification TypeRegistry
 * Maps notification method names to their param types
 */
export type NotificationTypeMap = {
    'deeplens/streamResult': {
        params: StreamResultNotificationParams;
    };
    'deeplens/progress': {
        params: ProgressNotificationParams;
    };
    'deeplens/ripgrepUnavailable': {
        params: unknown;
    };
    'workspace/symbol': {
        params: WorkspaceSymbolRequestParams;
    };
};

// ==================== Workspace Symbol Request ====================

export interface WorkspaceSymbolRequestParams {
    query: string;
}

export type WorkspaceSymbolRequestResult = SymbolInformation[];

export const WorkspaceSymbolRequest = new RequestType<WorkspaceSymbolRequestParams, WorkspaceSymbolRequestResult, void>(
    'workspace/symbol',
);
