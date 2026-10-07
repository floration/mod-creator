package com.example.azuregrove;

import net.fabricmc.api.ModInitializer;

import com.example.azuregrove.generated.ModContent;

/** Your mod's entrypoint. Floration created this file once; it is yours to edit. */
public class AzuregroveMod implements ModInitializer {
	@Override
	public void onInitialize() {
		ModContent.register();

		// Add hand-written setup below.
	}
}
