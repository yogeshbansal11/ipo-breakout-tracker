import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket(url) {
  const [isConnected, setIsConnected] = useState(false);
  const [stocks, setStocks] = useState([]);
  const [breakoutAlerts, setBreakoutAlerts] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const lastStocksJson = useRef('');
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      // Don't connect if already unmounted (StrictMode cleanup)
      if (!mountedRef.current) return;

      // Close any existing connection first
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent ghost reconnect
        wsRef.current.close();
        wsRef.current = null;
      }

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) { ws.close(); return; }
          setIsConnected(true);
          reconnectAttempts.current = 0;
          console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case 'INIT':
              case 'STOCKS_UPDATE': {
                const newJson = JSON.stringify(data.stocks);
                if (newJson !== lastStocksJson.current) {
                  lastStocksJson.current = newJson;
                  setStocks(data.stocks || []);
                }
                break;
              }
              case 'BREAKOUT_ALERT':
                setBreakoutAlerts(prev => [...prev, ...data.breakouts]);
                break;
              case 'PRICE_UPDATE':
                break;
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        ws.onclose = () => {
          // Only reconnect if the component is still mounted
          if (!mountedRef.current) return;
          setIsConnected(false);
          console.log('WebSocket disconnected');

          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        console.error('WebSocket connection error:', error);
      }
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect from cleanup close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url]);

  const clearAlerts = useCallback(() => {
    setBreakoutAlerts([]);
  }, []);

  const dismissAlertAtIndex = useCallback((index) => {
    setBreakoutAlerts(prev => prev.filter((_, i) => i !== index));
  }, []);

  return {
    isConnected,
    stocks,
    breakoutAlerts,
    clearAlerts,
    dismissAlertAtIndex
  };
}
