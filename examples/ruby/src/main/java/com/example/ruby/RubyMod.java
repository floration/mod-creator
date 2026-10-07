package com.example.ruby;

import net.fabricmc.api.ModInitializer;

import com.example.ruby.generated.ModContent;

/** Your mod's entrypoint. Floration created this file once; it is yours to edit. */
public class RubyMod implements ModInitializer {
	@Override
	public void onInitialize() {
		ModContent.register();

		// Add hand-written setup below.
	}
}
