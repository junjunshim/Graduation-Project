#pragma once

namespace app_utils {
    // 권한 비트마스크 폭(비트 수).
    //
    // 단일 정의 지점: DB 의 권한 비트 폭은 data/00_domain_authority.sql 의 authority_mask 도메인이,
    // 클라이언트는 grad_client/.../authorityDefinitions.ts 의 AUTHORITY_BIT_WIDTH 가 담당한다.
    // 비트 폭을 늘릴 때는 이 세 곳을 함께 수정한다.
    constexpr int kAuthorityBitLength = 32;

    // 절대 거부(DENY) 비트 위치. 켜지면 하위 비트와 무관하게 모든 권한이 무효화된다.
    constexpr int kAuthorityDenyBit = 31;
}
