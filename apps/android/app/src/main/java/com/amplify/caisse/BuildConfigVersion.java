package com.amplify.caisse;

import android.content.Context;

/** The app version (shown to the till, so it knows it runs inside the Android app). */
final class BuildConfigVersion {
    private BuildConfigVersion() { }

    static String name(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; }
        catch (Exception e) { return "1"; }
    }
}
