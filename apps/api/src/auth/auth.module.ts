import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { CredentialTokensService } from './credential-tokens.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';
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
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    TokenService,
    CredentialTokensService,
    LoginRateLimiterService,
    // Global guard order (Blueprint §9): authenticate, then authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService, TokenService, CredentialTokensService, LoginRateLimiterService],
})
export class AuthModule {}
