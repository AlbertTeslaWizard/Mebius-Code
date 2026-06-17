package com.mebiuscode.mobile.data

import org.junit.Assert.assertEquals
import org.junit.Test

class MebiusApiTest {
    @Test
    fun webRegisterUrlUsesPublicWebForBlankDefaultApi() {
        assertEquals(
            "http://182.92.150.169/register",
            webRegisterUrl(""),
        )
    }

    @Test
    fun webRegisterUrlDerivesWebOriginForCustomApi() {
        assertEquals(
            "http://example.com/register",
            webRegisterUrl("http://example.com/api"),
        )
    }
}
