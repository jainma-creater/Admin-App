import { useEffect, useState } from "react";
import * as Network from "expo-network";

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: string | null;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: null,
    type: null,
  });

  useEffect(() => {
    const checkNetwork = async () => {
      const netInfo = await Network.getNetworkStateAsync();
      setStatus({
        isConnected: netInfo.isConnected ?? true,
        isInternetReachable: netInfo.isInternetReachable ?? null,
        type: netInfo.type ?? null,
      });
    };

    checkNetwork();
    const subscription = Network.addNetworkStateListener((netInfo) => {
      setStatus({
        isConnected: netInfo.isConnected ?? true,
        isInternetReachable: netInfo.isInternetReachable ?? null,
        type: netInfo.type ?? null,
      });
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return status;
}

export async function syncWhenOnline(onSync: () => Promise<void>): Promise<void> {
  const netInfo = await Network.getNetworkStateAsync();
  if (netInfo.isConnected && netInfo.isInternetReachable) {
    await onSync();
  }
}