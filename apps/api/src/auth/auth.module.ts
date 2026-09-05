import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { CredentialTokensService } from './credential-tokens.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { OnboardingService } from './onboarding.service';
import { GoogleAuthController } from './google/google-auth.controller';
import { GoogleAuthService } from './google/google-auth.service';
import {
  GOOGLE_OIDC_CLIENT,
  HttpGoogleOidcClient,
} from './google/google-oidc.client';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from '../access/permissions.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
          throw new Error(
            'JWT_ACCESS_SECRET is not set. Run .alloy/populate-env.sh',
          );
        }
        return { secret };
      },
    }),
  ],
  controllers: [AuthController, MeController, GoogleAuthController],
  providers: [
    AuthService,
    TokenService,
    CredentialTokensService,
    LoginRateLimiterService,
    OnboardingService,
    GoogleAuthService,
    // DI boundary: tests override this token with a fake Google client.
    { provide: GOOGLE_OIDC_CLIENT, useClass: HttpGoogleOidcClient },
    // Global guard order (Blueprint §9): authenticate, then authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [
    AuthService,
    TokenService,
    CredentialTokensService,
    LoginRateLimiterService,
    OnboardingService,
    GoogleAuthService,
  ],
})
export class AuthModule {}
