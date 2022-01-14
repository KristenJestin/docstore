using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Docstore.Persistence.Migrations
{
    public partial class Document_Add_ReceivedAndEndsDates : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "EndsAt",
                table: "Documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReceivedAt",
                table: "Documents",
                type: "timestamp with time zone",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EndsAt",
                table: "Documents");

            migrationBuilder.DropColumn(
                name: "ReceivedAt",
                table: "Documents");
        }
    }
}
