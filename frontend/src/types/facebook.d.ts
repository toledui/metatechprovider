export {};

declare global {
  interface Window {
    FB?: {
      init(options: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
      }): void;
      login(
        callback: (response: FacebookLoginResponse) => void,
        options: {
          config_id: string;
          response_type: "code";
          override_default_response_type: true;
          extras?: {
            featureType?: "whatsapp_business_app_onboarding";
            sessionInfoVersion: "3";
          };
        },
      ): void;
    };
  }

  interface FacebookLoginResponse {
    authResponse?: {
      code?: string;
    };
    status?: string;
  }
}
