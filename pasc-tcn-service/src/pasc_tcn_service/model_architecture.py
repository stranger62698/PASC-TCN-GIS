"""Frozen inference-only PASC-TCN architecture.

This file contains only the modules required to load and execute the formal M4
state dictionary. The layer definitions are locked to the authoritative source.
"""

from __future__ import annotations

import torch
import torch.nn as nn

ARCHITECTURE_VERSION = "physics-tcn-m4-inference-v1"
AUTHORITATIVE_SOURCE_SHA256 = (
    "16e4de4a65c8861647103dbafb7758a5236761faab158657fe4abfbe8d64186c"
)


class Chomp1d(nn.Module):
    def __init__(self, chomp_size: int):
        super().__init__()
        self.chomp_size = chomp_size

    def forward(self, values):
        if self.chomp_size == 0:
            return values
        return values[:, :, : -self.chomp_size].contiguous()


class TemporalBlock(nn.Module):
    def __init__(
        self,
        input_channels: int,
        output_channels: int,
        kernel_size: int,
        dilation: int,
        dropout: float,
    ):
        super().__init__()
        padding = (kernel_size - 1) * dilation
        self.conv1 = nn.Conv1d(
            input_channels,
            output_channels,
            kernel_size,
            padding=padding,
            dilation=dilation,
        )
        self.conv2 = nn.Conv1d(
            output_channels,
            output_channels,
            kernel_size,
            padding=padding,
            dilation=dilation,
        )
        self.net = nn.Sequential(
            self.conv1,
            Chomp1d(padding),
            nn.ReLU(),
            nn.Dropout(dropout),
            self.conv2,
            Chomp1d(padding),
            nn.ReLU(),
            nn.Dropout(dropout),
        )
        self.downsample = (
            nn.Conv1d(input_channels, output_channels, 1)
            if input_channels != output_channels
            else nn.Identity()
        )
        self.activation = nn.ReLU()

    def forward(self, values):
        return self.activation(self.net(values) + self.downsample(values))


class TCNEncoder(nn.Module):
    def __init__(
        self,
        channels=(32, 64, 64, 128, 128),
        kernel_size: int = 5,
        dropout: float = 0.05,
    ):
        super().__init__()
        layers = []
        for index, output_channels in enumerate(channels):
            input_channels = 1 if index == 0 else channels[index - 1]
            layers.append(
                TemporalBlock(
                    input_channels,
                    output_channels,
                    kernel_size,
                    2**index,
                    dropout,
                )
            )
        self.network = nn.Sequential(*layers)
        self.output_size = channels[-1]

    def forward(self, values):
        return self.network(values).mean(dim=2)


class PhysicsTCN(nn.Module):
    def __init__(self, physics_size: int, classes: int = 6, use_spatial: bool = True):
        super().__init__()
        self.use_spatial = use_spatial
        self.encoder = TCNEncoder()
        self.physics_encoder = nn.Sequential(
            nn.Linear(physics_size, 32),
            nn.GELU(),
            nn.Dropout(0.08),
            nn.Linear(32, 32),
            nn.GELU(),
        )
        self.node_projector = nn.Sequential(
            nn.Linear(self.encoder.output_size + 32, 128),
            nn.GELU(),
            nn.LayerNorm(128),
        )
        self.physics_classifier = nn.Linear(32, classes)
        self.classifier = nn.Linear(128, classes)
        self.physics_scale = nn.Parameter(torch.tensor(-1.0))
        if use_spatial:
            self.spatial_gate = nn.Sequential(
                nn.Linear(128 * 3 + 1, 128),
                nn.GELU(),
                nn.Linear(128, 128),
                nn.Sigmoid(),
            )
            self.spatial_norm = nn.LayerNorm(128)

    def encode_node(self, series, physics):
        temporal_feature = self.encoder(series)
        physics_feature = self.physics_encoder(physics)
        node = self.node_projector(
            torch.cat([temporal_feature, physics_feature], dim=1)
        )
        return node, physics_feature

    def classify_node(self, node, physics_feature):
        scale = torch.sigmoid(self.physics_scale)
        physics_logits = self.physics_classifier(physics_feature)
        logits = self.classifier(node) + scale * physics_logits
        return logits, physics_logits

    def forward(
        self,
        series,
        physics,
        neighbor_series=None,
        neighbor_physics=None,
        neighbor_weights=None,
        reliability=None,
    ):
        node, physics_feature = self.encode_node(series, physics)
        if not self.use_spatial:
            logits, physics_logits = self.classify_node(node, physics_feature)
            return {"logits": logits, "physics_logits": physics_logits}

        batch, neighbors, _, length = neighbor_series.shape
        flat_series = neighbor_series.reshape(batch * neighbors, 1, length)
        flat_physics = neighbor_physics.reshape(batch * neighbors, -1)
        neighbor_node, neighbor_physics_feature = self.encode_node(
            flat_series, flat_physics
        )
        neighbor_node = neighbor_node.reshape(batch, neighbors, -1)
        neighbor_physics_feature = neighbor_physics_feature.reshape(
            batch, neighbors, -1
        )
        context = torch.sum(neighbor_weights.unsqueeze(-1) * neighbor_node, dim=1)
        disagreement = torch.abs(context - node)
        gate_input = torch.cat(
            [node, context, disagreement, reliability.unsqueeze(1)],
            dim=1,
        )
        gate = self.spatial_gate(gate_input) * reliability[:, None]
        fused = self.spatial_norm(node + gate * (context - node))
        logits, physics_logits = self.classify_node(fused, physics_feature)

        flat_neighbor_logits, _ = self.classify_node(
            neighbor_node.reshape(batch * neighbors, -1),
            neighbor_physics_feature.reshape(batch * neighbors, -1),
        )
        neighbor_logits = flat_neighbor_logits.reshape(batch, neighbors, -1)
        return {
            "logits": logits,
            "physics_logits": physics_logits,
            "neighbor_logits": neighbor_logits,
            "spatial_gate_mean": gate.mean(dim=1),
        }
