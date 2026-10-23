#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "game_structs.h"

// Minimal protobuf wire-format reader over a game message body.
struct ProtoReader {
    const uint8_t* p;
    const uint8_t* end;

    bool ok() const { return p < end; }

    uint64_t varint() {
        uint64_t v = 0; int s = 0;
        while (p < end) {
            uint8_t b = *p++;
            v |= (uint64_t)(b & 0x7F) << s;
            if (!(b & 0x80)) break;
            s += 7;
        }
        return v;
    }

    bool tag(int& field, int& wire) {
        if (p >= end) return false;
        uint64_t t = varint();
        if (t == 0) return false;
        field = (int)(t >> 3);
        wire  = (int)(t & 0x7);
        return true;
    }

    void skip(int wire) {
        if      (wire == 0) varint();
        else if (wire == 2) { uint64_t n = varint(); p += n; }
        else if (wire == 1) p += 8;
        else if (wire == 5) p += 4;
    }

    ProtoReader sub() {
        uint64_t n = varint();
        ProtoReader s{ p, p + n };
        p += n;
        return s;
    }

    uint32_t fixed32() {
        uint32_t v = 0;
        if (p + 4 <= end) {
            v = (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
                ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
            p += 4;
        }
        return v;
    }

    uint64_t fixed64() {
        uint64_t v = 0;
        if (p + 8 <= end) {
            v = (uint64_t)p[0] | ((uint64_t)p[1] << 8) |
                ((uint64_t)p[2] << 16) | ((uint64_t)p[3] << 24) |
                ((uint64_t)p[4] << 32) | ((uint64_t)p[5] << 40) |
                ((uint64_t)p[6] << 48) | ((uint64_t)p[7] << 56);
            p += 8;
        }
        return v;
    }

    std::string str() {
        uint64_t n = varint();
        std::string s(reinterpret_cast<const char*>(p), n);
        p += n;
        return s;
    }

    std::vector<uint32_t> packed_uint32() {
        auto s = sub();
        std::vector<uint32_t> v;
        while (s.ok()) v.push_back((uint32_t)s.varint());
        return v;
    }

    std::vector<uint64_t> packed_uint64() {
        auto s = sub();
        std::vector<uint64_t> v;
        while (s.ok()) v.push_back(s.varint());
        return v;
    }
};

inline ProtoReader MakeReader(System_Byte_array* body) {
    if (!body || body->max_length == 0) return { nullptr, nullptr };
    auto* p = reinterpret_cast<const uint8_t*>(body->m_Items);
    return { p, p + body->max_length };
}
