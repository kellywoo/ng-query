import { Observable } from 'rxjs';

export type RxQueryMutateFn<S> = (t: S) => S;

export type RxQueryStatus<A> = {
  /**
   * @description last successful updating time
   * default is 0
   **/
  ts: number;
  /**
   * @description returned query response
   **/
  data: A;
  /**
   * @description fetch requested
   **/
  loading: boolean;
  /**
   * @description returned query error
   **/
  error: Error | null;
  /**
   * @description init data or loading and error on manual fetch
   * (if refetch ends up with error, this state does not change)
   **/
  untrustedData?: boolean;
};

export interface RxStoreOption<A, B> {
  /**
   * @description store key
   **/
  key: string;
  /**
   * @description initial data
   **/
  initState: A;
  /**
   * @description used to check cache-key and inside select
   **/
  isEqual?: (a: any, b: any, nth?: number) => boolean;
  /**
   * @description query for fetch or any asynchronous operation
   **/
  query?: null | ((s?: B) => Observable<A>);
}

export interface RxQueryOption<A, B> extends RxStoreOption<A, B> {
  /**
   * @description ignore any refetch and cache strategy
   **/
  staticStore?: boolean;
  /**
   * @description perform query with the construction of the store. should have param property
   **/
  prefetch?: RxQueryParam<B> | null;
  /**
   * @description refetch on reconnect(if the backgroundstaletime has passed)
   **/
  refetchOnReconnect?: boolean;
  /**
   * @description refetch on visibility changes(if the backgroundstaletime has passed)
   **/
  refetchOnEmerge?: boolean;
  /**
   * @description interval for refetch, if query performs before next routine, it reset the timer
   **/
  refetchInterval?: number;
  /**
   * @description retry times for error
   **/
  retry?: number;
  /**
   * @description delay time for retry
   **/
  retryDelay?: number;
  /**
   * @description on destroy the state and cache is kept and can be used for next time
   **/
  keepAlive?: boolean;
  /**
   * @description to distinguish unique cache, it takes param sent to fetch as argument
   **/
  paramToCachingKey?: (p: any) => any;
  /**
   * @description how many cache(distinguished by cachekey) can be saved. default is 0.
   **/
  caching?: number;
  /**
   * @description refetch or reconnect debounce time
   **/
  backgroundStaleTime?: number;
  /**
   * @description automatically stops refetch on background(window visibility hidden) & offline
   * with true, it will refetch in background
   **/
  backgroundRefetch?: boolean;
}

export type RxQueryParam<B> = { param?: B; refetch?: boolean };