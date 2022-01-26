using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Docstore.Persistence.Migrations
{
    public partial class DocumentFile_Update_DocumentOptional : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DocumentFiles_Documents_DocumentId",
                table: "DocumentFiles");

            migrationBuilder.AlterColumn<int>(
                name: "DocumentId",
                table: "DocumentFiles",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddForeignKey(
                name: "FK_DocumentFiles_Documents_DocumentId",
                table: "DocumentFiles",
                column: "DocumentId",
                principalTable: "Documents",
                principalColumn: "Id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DocumentFiles_Documents_DocumentId",
                table: "DocumentFiles");

            migrationBuilder.AlterColumn<int>(
                name: "DocumentId",
                table: "DocumentFiles",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_DocumentFiles_Documents_DocumentId",
                table: "DocumentFiles",
                column: "DocumentId",
                principalTable: "Documents",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
