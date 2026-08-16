import { metaConfig, metaGraphUrl } from "../config/meta.js";
import { AppError } from "../lib/errors.js";
import { getMetaSettings } from "../settings/service.js";

interface MetaErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface TokenExchangeResponse extends MetaErrorResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface DebugTokenResponse extends MetaErrorResponse {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    expires_at?: number;
    data_access_expires_at?: number;
    user_id?: string;
    granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
  };
}

export interface MetaPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  platform_type?: string;
}

interface PhoneNumbersResponse extends MetaErrorResponse {
  data?: MetaPhoneNumber[];
}

export interface MetaSessionInfo {
  wabaId?: string | undefined;
  phoneNumberId?: string | undefined;
  businessId?: string | undefined;
}

export interface MetaOnboardingResult {
  accessToken: string;
  expiresAt?: Date | undefined;
  wabaId: string;
  businessId?: string | undefined;
  metaUserId?: string | undefined;
  phone: MetaPhoneNumber;
}

async function requireMetaCredentials(): Promise<{
  appId: string;
  appSecret: string;
  configId: string;
}> {
  const setting = await getMetaSettings();
  if (!setting?.enabled) {
    throw new AppError(
      503,
      "meta_not_configured",
      "Configura y activa Meta desde el panel Superadmin.",
    );
  }

  return setting.config;
}

async function metaJson<T>(url: URL | string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new AppError(
      502,
      "meta_unavailable",
      "No fue posible conectar con Meta Graph API.",
      error instanceof Error ? error.message : undefined,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as T & MetaErrorResponse;
  if (!response.ok || payload.error) {
    throw new AppError(
      502,
      "meta_api_error",
      payload.error?.message ?? "Meta Graph API rechazó la solicitud.",
      {
        type: payload.error?.type,
        code: payload.error?.code,
        subcode: payload.error?.error_subcode,
        traceId: payload.error?.fbtrace_id,
      },
    );
  }

  return payload;
}

async function exchangeCode(code: string): Promise<TokenExchangeResponse> {
  const { appId, appSecret } = await requireMetaCredentials();
  const url = new URL(`${metaConfig.graphApiBaseUrl}/${metaConfig.graphApiVersion}/oauth/access_token`);
  url.search = new URLSearchParams({ client_id: appId, client_secret: appSecret, code }).toString();

  const payload = await metaJson<TokenExchangeResponse>(url);
  if (!payload.access_token) {
    throw new AppError(502, "invalid_meta_response", "Meta no devolvió un access token.");
  }

  return payload;
}

async function debugToken(accessToken: string): Promise<DebugTokenResponse["data"]> {
  const { appId, appSecret } = await requireMetaCredentials();
  const url = new URL(`${metaConfig.graphApiVersionedBaseUrl}/debug_token`);
  url.search = new URLSearchParams({
    input_token: accessToken,
    access_token: `${appId}|${appSecret}`,
  }).toString();

  const payload = await metaJson<DebugTokenResponse>(url);
  if (!payload.data?.is_valid || payload.data.app_id !== appId) {
    throw new AppError(401, "invalid_meta_token", "El token emitido por Meta no es válido para esta aplicación.");
  }

  return payload.data;
}

async function phoneNumbers(wabaId: string, accessToken: string): Promise<MetaPhoneNumber[]> {
  const url = new URL(metaGraphUrl(`${wabaId}/phone_numbers`));
  url.searchParams.set(
    "fields",
    "id,display_phone_number,verified_name,quality_rating,platform_type",
  );
  const payload = await metaJson<PhoneNumbersResponse>(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return payload.data ?? [];
}

async function subscribeApp(wabaId: string, accessToken: string): Promise<void> {
  await metaJson(metaGraphUrl(`${wabaId}/subscribed_apps`), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function completeEmbeddedSignup(
  code: string,
  sessionInfo: MetaSessionInfo,
): Promise<MetaOnboardingResult> {
  const token = await exchangeCode(code);
  const debug = await debugToken(token.access_token!);
  const scopedWabaIds = debug?.granular_scopes
    ?.filter((scope) => scope.scope === "whatsapp_business_management")
    .flatMap((scope) => scope.target_ids ?? []) ?? [];
  const wabaId = sessionInfo.wabaId ?? scopedWabaIds[0];

  if (!wabaId) {
    throw new AppError(
      422,
      "waba_not_found",
      "Meta no devolvió un WABA. Revisa los activos asignados a la configuración de Embedded Signup.",
    );
  }

  const availablePhones = await phoneNumbers(wabaId, token.access_token!);
  const phone = sessionInfo.phoneNumberId
    ? availablePhones.find((candidate) => candidate.id === sessionInfo.phoneNumberId)
    : availablePhones.length === 1
      ? availablePhones[0]
      : undefined;

  if (!phone) {
    throw new AppError(
      409,
      "phone_number_ambiguous",
      availablePhones.length === 0
        ? "El WABA no tiene números de teléfono disponibles."
        : "Meta devolvió varios números y no indicó cuál fue vinculado.",
      { phoneNumbers: availablePhones.map(({ id, display_phone_number }) => ({ id, display_phone_number })) },
    );
  }

  await subscribeApp(wabaId, token.access_token!);

  return {
    accessToken: token.access_token!,
    expiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1_000)
      : debug?.expires_at
        ? new Date(debug.expires_at * 1_000)
        : undefined,
    wabaId,
    businessId: sessionInfo.businessId,
    metaUserId: debug?.user_id,
    phone,
  };
}
