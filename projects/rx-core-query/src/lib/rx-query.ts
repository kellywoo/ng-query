import {
  catchError,
  combineLatest,
  debounceTime,
  delay,
  distinctUntilChanged,
  EMPTY,
  filter,
  map,
  merge,
  Observable,
  of,
  skip,
  Subject,
  Subscription,
  switchMap,
  take,
  takeUntil,
  tap,
  timer,
  withLatestFrom,
} from 'rxjs';
import { RxQueryMutateFn, RxQueryOption, RxQueryStatus } from './rx-query.model';
import {
  RxQueryNotifier,
  RxQueryOptionSchemed,
  RxStoreOptionSchemed,
} from './rx-query.schemed.model';
import { RxStoreAbstract } from './rx-store';
import { shallowEqualDepth } from './rx-query.util';
import { INIT_CACHE_KEY, RxState } from './rx-state';
import { RxCache } from './rx-cache';
import { getRxConstSettings, RxConst } from './rx-const';

export class RxQuery<A, B = any> extends RxStoreAbstract<A, B> {
  protected readonly trigger$: Subject<{ refetch?: boolean; cache: RxCache; param?: B }> =
    new Subject();
  protected readonly key: string;
  protected readonly initState: A;
  protected readonly query: RxStoreOptionSchemed<A, B>['query'];
  protected readonly isEqual: RxStoreOptionSchemed<A, B>['isEqual'];
  protected readonly retry: number;
  protected readonly retryDelay: number;

  private readonly refetchInterval: number;
  private readonly refetchOnReconnect: boolean;
  private readonly refetchOnEmerge: boolean;
  private readonly backgroundStaleTime: number;
  private readonly backgroundRefetch: boolean;
  private readonly keepAlive: boolean;
  private readonly paramToCachingKey?: (p: any) => any;

  private readonly cacheState: RxState;
  private readonly refetchInterval$ = new Subject<number>();
  private readonly destroy$ = new Subject<void>();

  private fetched = false;
  private refetchDisabled = false;
  private isOnBackground: boolean = false;
  private refetchSbuscription?: Subscription;
  private latestParam?: B;
  private lastSuccessTime = 0;
  private RX_CONST: RxConst;

  constructor(
    options: RxQueryOption<A, B>,
    private notifiers: RxQueryNotifier,
    cacheState?: RxState,
  ) {
    super();
    this.RX_CONST = getRxConstSettings();
    const {
      prefetch,
      initState,
      key,
      retry,
      retryDelay,
      refetchOnReconnect,
      refetchOnEmerge,
      refetchInterval,
      backgroundStaleTime,
      backgroundRefetch,
      caching,
      keepAlive,
      paramToCachingKey,
      query,
      isEqual,
    } = this.getDefaultOption(options);
    this.key = key;
    this.query = query;
    this.initState = Object.freeze(initState);
    this.refetchInterval = refetchInterval * 1000;
    this.retry = retry;
    this.retryDelay = retryDelay * 1000;
    this.backgroundStaleTime = backgroundStaleTime * 1000;
    this.backgroundRefetch = backgroundRefetch;
    this.refetchOnReconnect = refetchOnReconnect;
    this.refetchOnEmerge = refetchOnEmerge;
    this.keepAlive = keepAlive;
    this.isEqual = isEqual;
    this.paramToCachingKey = paramToCachingKey;
    this.subscribeBackgroundMode();
    this.cacheState =
      this.keepAlive && cacheState
        ? cacheState
        : new RxState<A, B>({ max: caching, min: this.RX_CONST.defaultCaching }, this.initState);
    if (this.cacheState === cacheState) {
      this.cacheState.restart();
    }
    this.initQueryStream();
    if (prefetch) {
      this.fetch(prefetch.param);
    }
  }

  private subscribeBackgroundMode() {
    combineLatest([
      merge(of(document.visibilityState === 'visible'), this.notifiers.visibilityChange$),
      merge(of(navigator.onLine), this.notifiers.online$),
    ])
      .pipe(
        map<[boolean, boolean], boolean>(([visibility, online]) => {
          return !visibility || !online;
        }),
        distinctUntilChanged(),
        takeUntil(this.destroy$),
      )
      .subscribe((isOnBackground) => {
        this.isOnBackground = isOnBackground;
        // last resort for failed refetch by background mode.
        if (
          !this.isOnBackground &&
          !this.backgroundRefetch &&
          !this.refetchOnEmerge &&
          !this.refetchOnReconnect &&
          this.lastSuccessTime + this.refetchInterval < Date.now()
        ) {
          this.refetch();
        }
      });
  }

  private initQueryStream() {
    this.trigger$
      .pipe(
        debounceTime(0), // prevent multi request for one
        switchMap(({ param, cache, refetch }: any) => {
          let retryTimes = this.retry;
          return this.query(param).pipe(
            delay(100),
            tap((res) => {
              cache.onSuccess(res, param);
              this.refetchInterval$.next(this.refetchInterval);
              this.lastSuccessTime = Date.now();
            }),
            catchError((err, caught) => {
              if (this.isOnBackground) {
                cache.onError(err, refetch);
                return EMPTY;
              }
              if (retryTimes > 0) {
                retryTimes--;
                return timer(this.retryDelay).pipe(switchMap(() => caught));
              } else {
                cache.onError(err, refetch);
                return EMPTY;
              }
            }),
          );
        }),
        takeUntil(this.destroy$),
      )
      .subscribe();

    this.refetchInterval$
      .pipe(
        switchMap((intervalTime) => {
          return intervalTime === -1 ? EMPTY : timer(intervalTime);
        }),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        if (this.refetchDisabled) {
          return;
        }
        if (!this.isOnBackground || this.backgroundRefetch) {
          this.refetch();
        }
      });
  }

  private getCacheKey(param?: any) {
    if (this.cacheState.max === 0) {
      return INIT_CACHE_KEY;
    }

    if (
      param &&
      typeof param === 'object' &&
      Object.prototype.hasOwnProperty.call(param, 'rxQueryHashKey')
    ) {
      return param.rxQueryHashKey;
    }

    if (this.paramToCachingKey) {
      return this.paramToCachingKey(param);
    }
    return param;
  }

  private getDefaultOption(options: RxQueryOption<A, B>): RxQueryOptionSchemed<A, B> {
    const {
      backgroundStaleTime,
      defaultRetryDelay,
      defaultRetry,
      defaultCaching,
      defaultInterval,
      minRefetchTime,
      maxCaching,
    } = this.RX_CONST;
    return {
      key: options.key,
      query: options.query || ((a?: B) => of(a as unknown as A)),
      initState: options.initState,
      prefetch: options.prefetch || null,
      refetchOnEmerge: options.refetchOnEmerge || false,
      refetchOnReconnect: options.refetchOnReconnect || false,
      backgroundStaleTime: options.backgroundStaleTime ?? backgroundStaleTime,
      retry: options.retry ?? defaultRetry,
      retryDelay: options.retryDelay ?? defaultRetryDelay,
      isEqual: options.isEqual || shallowEqualDepth,
      keepAlive: options.keepAlive || false,
      paramToCachingKey: options.paramToCachingKey,
      backgroundRefetch: options.backgroundRefetch || false,
      refetchInterval: Math.max(options.refetchInterval || defaultInterval, minRefetchTime), // does not take 0
      caching: Math.min(Math.max(options.caching || defaultCaching, 0), maxCaching),
    };
  }

  private setRefetchStrategy(fetchInitiated: boolean) {
    if (this.fetched === fetchInitiated) {
      return;
    }
    this.fetched = fetchInitiated;
    if (!this.refetchOnReconnect && this.refetchOnEmerge) {
      return;
    }
    if (!this.fetched) {
      this.refetchSbuscription?.unsubscribe();
      return;
    }
    // refetch condition..
    this.refetchSbuscription = combineLatest([
      this.notifiers.visibilityChange$ && this.refetchOnEmerge
        ? merge(of(true), this.notifiers.visibilityChange$)
        : of(true),
      this.notifiers.online$ && this.refetchOnReconnect
        ? merge(of(true), this.notifiers.online$)
        : of(true),
    ])
      .pipe(
        skip(1), // first response is just placeholder
        map<[boolean, boolean], boolean>(([visibility, online]) => {
          return visibility && online;
        }),
        delay(0),
        distinctUntilChanged(),
        withLatestFrom(this.cacheState.getState().pipe(take(1))),
        filter(([reconnectedOrEmerge, state]) => {
          if (reconnectedOrEmerge) {
            if (state.untrustedData) {
              // previous fetch must have failed so prepare it.
              return true;
            }
            const now = Date.now();
            return now - state.ts > this.backgroundStaleTime;
          }
          return false;
        }),
        delay(200),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.refetch();
      });
  }

  public readonly select = <T>(selector?: (s: A) => T) => {
    return this.cacheState.getState().pipe(
      map((state) => {
        return selector ? selector(state.data) : (state.data as unknown as T);
      }),
      distinctUntilChanged((a, b) => this.isEqual(a, b, 1)),
    );
  };

  public readonly status: () => Observable<RxQueryStatus<A>> = () => {
    // whole
    return this.cacheState.getState().pipe(distinctUntilChanged((a, b) => this.isEqual(a, b, 2)));
  };

  public readonly fetch = (param?: B, refetch?: boolean) => {
    const cacheKey = this.getCacheKey(param);
    const cache = this.cacheState.createAndSwitch(cacheKey);
    this.setRefetchStrategy(true);
    cache.prepareFetching();
    this.latestParam = param;
    this.trigger$.next({ cache, refetch, param });
  };

  public readonly refetch = () => {
    if (!this.fetched || this.refetchDisabled) {
      return;
    }
    this.fetch(this.latestParam, true);
  };

  public readonly reset = () => {
    this.refetchInterval$.next(-1);
    this.setRefetchStrategy(false);
    this.cacheState.reset();
  };

  public readonly disableRefetch = (disabled: boolean) => {
    this.refetchDisabled = disabled;
  };

  public readonly mutate = (payload: RxQueryMutateFn<A>) => {
    return this.cacheState.getCurrentCache().onMutate(payload);
  };

  public readonly destroy = () => {
    this.destroy$.next();
    this.destroy$.complete();
    this.trigger$.complete();
    this.refetchInterval$.complete();
    if (this.keepAlive) {
      this.cacheState.pause();
    } else {
      this.cacheState.destroy();
    }
    if (this.notifiers?.destroy$) {
      this.notifiers.destroy$.next(this.key);
    }
  };

  public readonly getKeepAlivedState = () => {
    return this.cacheState?.alive ? this.cacheState : null;
  };
}
