package com.threadbeacon.control.common;

import com.threadbeacon.control.config.ThreadBeaconProperties;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

@Component
public class SecretBox {
    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public SecretBox(ThreadBeaconProperties properties) throws Exception {
        this.key = new SecretKeySpec(MessageDigest.getInstance("SHA-256").digest(properties.encryption().key().getBytes(StandardCharsets.UTF_8)), "AES");
    }

    public String encrypt(String value) {
        try {
            var nonce = new byte[12]; random.nextBytes(nonce);
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            var encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(nonce.length + encrypted.length).put(nonce).put(encrypted).array());
        } catch (Exception error) { throw new IllegalStateException("加密浏览器动作失败", error); }
    }

    public String decrypt(String value) {
        try {
            var bytes = Base64.getUrlDecoder().decode(value);var nonce = new byte[12];var encrypted = new byte[bytes.length - nonce.length];
            System.arraycopy(bytes, 0, nonce, 0, nonce.length);System.arraycopy(bytes, nonce.length, encrypted, 0, encrypted.length);
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception error) { throw new IllegalStateException("解密浏览器动作失败", error); }
    }
}
